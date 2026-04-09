from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
from tavily import TavilyClient
import subprocess
import os
import fitz
import psutil
import GPUtil
import requests
from bs4 import BeautifulSoup
import re

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
CORS(app)

# Initialize Tavily Client with your provided API key
tavily = TavilyClient(api_key="ENTER-API-KEY-HERE-FOR-TAVILY-DO-NOT-REMOVE-QUOTES")

@app.route("/search")
def search():
    query = request.args.get("q", "")
    if not query:
        return jsonify({"error": "No query provided"}), 400
    
    try:
        # Use advanced depth for richer content so the model doesn't hallucinate
        response = tavily.search(
            query=query,
            search_depth="advanced",
            max_results=5,
            include_answer=True,      # Tavily's own AI-distilled answer as a bonus signal
            include_raw_content=False # Raw HTML is too large; the content field is enough
        )
        
        results_list = response.get('results', [])
        tavily_answer = response.get('answer', '')
        
        # Ensure every result has a non-empty content field so the model doesn't blank out
        for r in results_list:
            if not r.get('content'):
                r['content'] = r.get('snippet', r.get('title', 'No content available'))
        
        print(f"[Tavily Search] '{query}' → {len(results_list)} results, answer: {'yes' if tavily_answer else 'no'}")
        
        return jsonify({"results": results_list, "answer": tavily_answer})

    except Exception as e:
        print(f"[search] ERROR: {e}")
        return jsonify({"error": str(e), "results": []})

@app.route("/command", methods=["POST"])
def command():
    cmd = request.json.get("command", "")
    if not cmd:
        return jsonify({"output": "No command provided"})
    try:
        # Original PowerShell execution logic
        result = subprocess.run(
            ["powershell", "-Command", cmd],
            capture_output=True, text=True, timeout=30
        )
        output = result.stdout or result.stderr or "Command completed with no output"
        return jsonify({"output": output})
    except subprocess.TimeoutExpired:
        return jsonify({"output": "Command timed out after 30 seconds"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/read_file", methods=["POST"])
def read_file():
    filepath = request.json.get("filepath", "")
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return jsonify({"output": f.read()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/write_file", methods=["POST"])
def write_file():
    filepath = request.json.get("filepath", "")
    content = request.json.get("content", "")
    try:
        if os.path.dirname(filepath):
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"output": f"Successfully written to {filepath}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/upload", methods=["POST"])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
        
    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)
        
        output_text_path = filepath
        
        # If it's a PDF, extract to txt to allow agent to read it easily
        if filename.lower().endswith(".pdf"):
            output_text_path = filepath + ".txt"
            doc = fitz.open(filepath)
            text = f"--- DATA FROM PDF: {filename} ---\n\n"
            for i, page in enumerate(doc):
                text += f"--- PAGE {i+1} ---\n{page.get_text()}\n\n"
            with open(output_text_path, "w", encoding="utf-8") as f:
                f.write(text)
                
        clean_path = os.path.abspath(output_text_path).replace("\\", "/")
        return jsonify({
            "success": True, 
            "filepath": clean_path,
            "filename": filename
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/stats")
def stats():
    gpu_percent = 0
    vram_percent = 0
    
    try:
        gpus = GPUtil.getGPUs()
        if gpus:
            gpu_percent = round(gpus[0].load * 100, 1)
            vram_percent = round(gpus[0].memoryUtil * 100, 1)
    except:
        pass
        
    return jsonify({"gpu": gpu_percent, "vram": vram_percent})

@app.route("/scrape", methods=["POST"])
def scrape_url():
    url = request.json.get("url", "")
    if not url:
        return jsonify({"error": "No URL provided"})
    try:
        res = requests.get(url, timeout=10)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, "html.parser")
        for script in soup(["script", "style"]):
            script.extract()
        text = soup.get_text(separator="\n")
        text = re.sub(r'\n\s*\n', '\n\n', text)
        return jsonify({"output": text.strip()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print("ph3dGPT backend running on http://localhost:5000")
    print("Search Engine: Tavily (Advanced Mode)")
    app.run(host="0.0.0.0", port=5000, debug=False)
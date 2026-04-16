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
import signal
import sys
import io

# Force UTF-8 at the environment level
os.environ["PYTHONIOENCODING"] = "utf-8"

class LlamaManager:
    def __init__(self):
        self.process = None
        self.path = r"C:\Users\Eddie\llama.cpp"

    def start(self, model_file, mmproj_file=None):
        if self.is_running():
            return True, "Already running"
        
        try:
            # Use port 8080 to match bot.js and defaults
            cmd = [
                os.path.join(self.path, "llama-server.exe"),
                "-m", os.path.join(self.path, "Models", model_file),
                "-ngl", "35",
                "-c", "16500",
                "--host", "0.0.0.0",
                "--port", "8080"
            ]
            
            if mmproj_file:
                cmd.extend(["--mmproj", os.path.join(self.path, "Models", mmproj_file)])

            self.process = subprocess.Popen(
                cmd,
                cwd=self.path,
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )
            return True, f"Started model: {model_file}"
        except Exception as e:
            return False, str(e)

    def stop(self):
        if not self.is_running():
            return True, "Not running"
        try:
            # Try to kill by process name as well for robustness
            subprocess.run(["taskkill", "/F", "/IM", "llama-server.exe"], capture_output=True)
            if self.process:
                self.process.terminate()
            self.process = None
            return True, "Stopped"
        except Exception as e:
            if self.process:
                self.process.kill()
            self.process = None
            return True, f"Force stopped ({e})"

    def is_running(self):
        # 1. Check if we have a live process handle
        if self.process and self.process.poll() is None:
            return True
        
        # 2. Hard check: Ping the actual port to see if a Ghost or manual instance is there
        try:
            # llama.cpp server usually has a /v1/models or /health endpoint
            r = requests.get("http://127.0.0.1:8080/v1/models", timeout=1)
            if r.status_code == 200:
                return True
        except:
            pass

        return False

llama_manager = LlamaManager()

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
CORS(app)

# Mute Flask/Werkzeug logging to prevent console crashes on request URLs containing symbols
import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

tavily = TavilyClient(api_key="")

def deep_sanitize(obj):
    """Recursively strip non-ASCII characters from any object (dict, list, str)"""
    if isinstance(obj, str):
        return obj.encode('ascii', 'ignore').decode('ascii')
    if isinstance(obj, list):
        return [deep_sanitize(x) for x in obj]
    if isinstance(obj, dict):
        return {k: deep_sanitize(v) for k, v in obj.items()}
    return obj

@app.route("/search")
def search():
    raw_query = request.args.get("q", "")
    if not raw_query:
        return jsonify({"error": "No query provided"}), 400
    
    # SANITIZE: Force ASCII-only for the search engine
    query = raw_query.encode('ascii', 'ignore').decode('ascii').strip()
    
    try:
        # Use advanced depth for richer content
        response = tavily.search(
            query=query,
            search_depth="advanced",
            max_results=5,
            include_answer=True,
            include_raw_content=False
        )
        
        results_list = response.get('results', [])
        tavily_answer = response.get('answer', '')
        
        for r in results_list:
            if not r.get('content'):
                r['content'] = r.get('snippet', r.get('title', 'No content available'))
        
        # TRIPLE-SHIELD: Sanitize the entire response object before sending
        final_data = deep_sanitize({
            "results": results_list, 
            "answer": tavily_answer
        })
        
        return jsonify(final_data)

    except Exception as e:
        # Sanitize the error message too, just in case
        return jsonify({"error": deep_sanitize(str(e)), "results": []})

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
    cpu_percent = psutil.cpu_percent()
    ram_percent = psutil.virtual_memory().percent
    
    try:
        gpus = GPUtil.getGPUs()
        if gpus:
            gpu_percent = round(gpus[0].load * 100, 1)
            vram_percent = round(gpus[0].memoryUtil * 100, 1)
    except:
        pass
        
    return jsonify({
        "gpu": gpu_percent, 
        "vram": vram_percent,
        "cpu": cpu_percent,
        "ram": ram_percent
    })

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

@app.route("/llama/models")
def llama_list_models():
    models_dir = os.path.join(llama_manager.path, "Models")
    if not os.path.exists(models_dir):
        return jsonify({"models": [], "projectors": []})
    
    files = os.listdir(models_dir)
    models = [f for f in files if f.endswith(".gguf") and "mmproj" not in f.lower()]
    projectors = [f for f in files if f.endswith(".gguf") and "mmproj" in f.lower()]
    
    return jsonify({"models": models, "projectors": projectors})

@app.route("/llama/start", methods=["POST"])
def llama_start():
    model = request.json.get("model")
    mmproj = request.json.get("mmproj") # Optional
    if not model:
        return jsonify({"success": False, "message": "No model file provided"})
        
    success, msg = llama_manager.start(model, mmproj)
    return jsonify({"success": success, "message": msg})

@app.route("/llama/stop", methods=["POST"])
def llama_stop():
    success, msg = llama_manager.stop()
    return jsonify({"success": success, "message": msg})

@app.route("/llama/status")
def llama_status():
    return jsonify({"running": llama_manager.is_running()})

if __name__ == "__main__":
    print("ph3dGPT backend running on http://localhost:5000")
    print("Search Engine: Tavily (Advanced Mode)")
    app.run(host="0.0.0.0", port=5000, debug=False)

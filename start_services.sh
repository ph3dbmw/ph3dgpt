#!/bin/bash

echo "========================================"
echo "Starting ph3dgpt Services"
echo "========================================"
echo ""

# Check for Ollama
echo "[1/4] Checking if Ollama is running locally..."
if curl -s http://localhost:11434/ | grep -q "Ollama is running"; then
    echo "[OK] Ollama is running!"
else
    echo "[WARNING] Ollama does not seem to be running on port 11434!"
    echo "Please make sure you have the Ollama service running."
    read -p "Press [Enter] to continue starting the services, or Ctrl+C to abort..."
fi

echo ""
echo "[2/4] Starting server2.py (in background)..."
# Start the tools backend Python server in the background
python3 server2.py > backend.log 2>&1 &
SERVER_PID=$!

echo ""
echo "[3/4] Starting llama.cpp Server (in background)..."
# Start the llama.cpp server in the background
# Note: Path adapted for shell environment
(cd "/mnt/c/Users/Eddie/llama.cpp" && ./llama-server -m "./Models/gemma-4-26b-a4b-it-heretic.q4_k_m.gguf" -ngl 35 -c 16500 --host 0.0.0.0 --port 8000) > llama.log 2>&1 &
LLAMA_PID=$!

echo ""
echo "[4/4] Starting WhatsApp Bot..."

# Function to properly kill background processes when we stop the script
cleanup() {
    echo ""
    echo "Stopping background services..."
    kill $SERVER_PID
    kill $LLAMA_PID
    echo "All services stopped."
    exit 0
}

# Trap SIGINT (Ctrl+C) and SIGTERM to run the cleanup function
trap cleanup SIGINT SIGTERM

# Start the bot in the foreground so you can see its output and scan the QR code
cd wabot && npm start

# Ollama ph3dGPT FrontEnd and Ollama WhatsApp Bot

A powerful, agentic WhatsApp bot integrating local LLMs via Ollama, along with experimental browser-based Claude.ai features. It features a dual-architecture with a Node.js frontend (WhatsApp Web JS) and a Python Flask backend for executing agentic tools like web search, file parsing, and system command execution.

## Features

- **Local AI via Ollama**: Connects to your local Ollama instance (defaults to `dolphin-mixtral:8x7b`).
- **Agentic Capabilities (`ph3dMode`)**: The bot can decide to use tools to fulfill requests:
  - `web_search`: Uses the Tavily API for highly accurate, AI-distilled real-time web search.
  - `scrape_url`: Fetches and extracts text from external webpages.
  - File reading, writing, and uploading (with PDF to text extraction).
- **Claude.ai Integration**: Forward prompts directly to the Claude.ai web interface via an automated Puppeteer browser.
- **Dynamic Configuration**: Change models, tweak "think" levels, and toggle features directly from WhatsApp chat commands.
- **Hardware Monitoring**: Built-in endpoints to track local GPU and VRAM utilization.

## Prerequisites

- **Node.js** (v14 or higher)
- **Python 3.8+**
- **Ollama** installed and running. Pull your desired models (e.g., `ollama run dolphin-mixtral:8x7b`).
- **Google Chrome** (Required for WhatsApp Web auth and Claude Puppeteer navigation).
- **Tavily API Key**: Required for web search capabilities.

## Setup & Installation

1. **Clone the repository** (or download the source files).
2. **Setup Python Backend**:
   Configure your Tavily API key inside `server2.py` if not already set.
   Install the required Python packages:
   ```cmd
   pip install flask flask-cors werkzeug tavily-python PyMuPDF psutil GPUtil requests beautifulsoup4
   ```
3. **Setup Node Frontend**:
   Navigate to the `wabot` directory and install the Node dependencies:
   ```cmd
   cd wabot
   npm install
   ```

## Running the Bot

The project includes convenient startup scripts to launch all services sequentially.

**On Windows:**
```cmd
start_services.bat
```

**On Linux/macOS:**
```bash
chmod +x start_services.sh
./start_services.sh
```

**What this does:**
1. Verifies that Ollama is currently running on `localhost:11434`.
2. Starts `server2.py` (the Tools Backend Server on port 5000).
3. Starts `bot.js` (the WhatsApp Bot). 

*On the very first run, you will need to scan the QR code generated in the terminal with your WhatsApp app (Linked Devices) to authenticate.*

## WhatsApp Commands

Once the bot is running, you can send the following commands in WhatsApp to interact with and configure it:

- `/mode` - Display the current active model, think level, and active modes.
- `/model <model_name>` - Switch the current Ollama model dynamically.
- `/ais` - View a list of all installed Ollama models on your machine.
- `/ph3dgpt` - Toggle tool-calling mode ON/OFF (enables Web Search, Scrape).
- `/think <0|1|2>` - Adjust the internal reasoning verbosity of the bot.
- `/claude` - Toggle Claude Mode. Routes questions through the opened Claude.ai tab in Chrome.
- `/reset` - Clear the conversation history for the current chat.

**Note on Usage**: The bot is configured to natively reply in Direct Messages or specific whitelisted groups. If a prefix is configured (default: `!ai`), prefix your requests with `!ai` for the bot to respond.

## Project Structure

- `start_services.bat` - Windows launch script.
- `start_services.sh` - Linux/macOS launch script.
- `server2.py` - Flask API backend serving tools and utilities.
- `agent.py` - Core agent logic/testing utility.
- `wabot/bot.js` - Main WhatsApp Web JS application and prompting logic.
- `wabot/package.json` - Node dependencies.

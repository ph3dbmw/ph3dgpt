# ph3dGPT WhatsApp Bot

A powerful, agentic WhatsApp bot integrating local LLMs via Ollama, along with experimental browser-based Claude.ai features. It features a dual-architecture with a Node.js frontend (WhatsApp Web JS) and a Python Flask backend for executing agentic tools like web search, file parsing, and system command execution.

## Features

- **Local AI via Ollama**: Connects to your local Ollama models with a dynamically adjustable backend setup.
- **The "ph3dGPT" Persona**:
  - Configured with a sharp, no-nonsense personality with a bit of an edge.
  - Intelligent handling of **Coding** (gives functional code with brief comments).
  - High-tier **Creative Writing** (always respects rhyming constraints for raps and poems).
  - **Math & Logic** solving (shows full working and equations).
  - Real-world **Date & Time** awareness (handled automatically via tool calling).
  - Automatic language detection mimicking the user.
- **Agentic Capabilities (`ph3dMode`)**: The bot can decide to use tools autonomously to fulfill requests:
  - **`web_search`**: Uses the Tavily API for highly accurate, AI-distilled real-time web searches.
  - **`scrape_url`**: Fetches and extracts text from external webpages for RAG (Retrieval-Augmented Generation).
- **Advanced Utilities (Backend API)**:
  - Local command execution via the backend (`/command` endpoint running PowerShell).
  - File generation and reading (`/read_file`, `/write_file`).
  - File uploading with automatic PDF-to-Text extraction (`/upload`).
  - Hardware Monitoring: Built-in `/stats` endpoint to track local GPU and VRAM utilization.
- **Claude.ai Integration (`claudeMode`)**: Forward prompts directly to the Claude.ai web interface via an automated Puppeteer browser.
- **Dynamic Configuration**: Change models, tweak "think" levels, and toggle features directly from WhatsApp chat commands.

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
- `/ph3dgpt` - Toggle tool-calling mode ON/OFF. When ON, it enables autonomous Web Search and Scraping.
- `/think <0|1|2>` - Adjust the internal reasoning verbosity of the bot:
  - `0`: Instant answers, minimal internal reasoning.
  - `1`: Moderate internal reasoning.
  - `2`: Full step-by-step deep thinking before answering.
- `/claude` - Toggle Claude Mode ON/OFF. Routes questions through the opened Claude.ai tab in Chrome.
- `/reset` - Clear the conversation history (up to 20 previous messages) for the current chat context.

**Note on Usage**: The bot is configured to natively reply in Direct Messages or specific whitelisted groups. If a prefix is configured (default: `!ai`), prefix your requests with `!ai` for the bot to respond.

## Web Interface Commands (ph3dGPT10.html)

In addition to WhatsApp, the project includes a local Web UI (`ph3dGPT10.html`) with a built-in command palette. Type `/` in the chat input to access these commands:

- `/personality` - Set a custom personality for this session.
- `/reset` - Reset personality to the default `ph3dGPT` persona.
- `/model` - Switch the active local Ollama model.
- `/clear` - Clear the current conversation to start fresh.
- `/compact` - Compress the conversation context to save VRAM and tokens.
- `/search` - Force a web search.
- `/scrape` - Scrape content from a URL directly.
- `/temp <0.0-2.0>` - Set the model's temperature (default 0.7). Lower = more focused/deterministic, higher = more creative/random.
- `/run` - Run a PowerShell command securely through the backend.
- `/read` - Read the contents of a local file.
- `/write |` - Write text content to a local file.

## Project Structure

- `start_services.bat` - Windows launch script.
- `start_services.sh` - Linux/macOS launch script.
- `server2.py` - Flask API backend serving tools and utilities.
- `agent.py` - Core agent logic/testing utility.
- `wabot/bot.js` - Main WhatsApp Web JS application and prompting logic.
- `wabot/package.json` - Node dependencies.

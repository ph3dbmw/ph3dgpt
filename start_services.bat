@echo off
title Start ph3dgpt Services
echo ========================================
echo Starting ph3dgpt Services
echo ========================================
echo.

echo [0/3] Purging zombie processes (Python & Llama)...
taskkill /F /IM python.exe /T > nul 2>&1
taskkill /F /IM llama-server.exe /T > nul 2>&1
echo [OK] Environment cleaned!

echo.
:: Check for Ollama and Auto-Start
echo [1/3] Checking if Ollama is running locally...
curl -s http://localhost:11434/ > nul
if %errorlevel% neq 0 (
    echo [ACTION] Ollama is not running. Attempting to start it...
    start "" "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"
    echo Waiting 5 seconds for Ollama to initialize...
    timeout /t 5 > nul
) else (
    echo [OK] Ollama is running!
)

echo.
echo [2/3] Starting server2.py (Silent Search Backend)...
:: Run hidden via PowerShell and redirect logs to server2.log
powershell -WindowStyle Hidden -Command "python server2.py > server2.log 2>&1"
echo [OK] Search Backend launched in background.

echo.
echo [3/3] Starting WhatsApp Bot...
start "WhatsApp Bot" cmd /k "cd wabot && npm start"

echo.
echo ========================================
echo All services launched! 
echo Backend server is running HIDDEN (see server2.log)
echo This window will close automatically in 3 seconds.
echo ========================================
timeout /t 3
exit

@echo off
title Start ph3dgpt Services
echo ========================================
echo Starting ph3dgpt Services
echo ========================================
echo.

:: Check for Ollama
echo [1/3] Checking if Ollama is running locally...
curl -s http://localhost:11434/ | findstr "Ollama is running" > nul
if %errorlevel% neq 0 (
    echo [WARNING] Ollama does not seem to be running on port 11434!
    echo Please make sure you have the Ollama app running.
    echo Press any key to continue starting the services, or Ctrl+C to abort...
    pause > nul
) else (
    echo [OK] Ollama is running!
)

echo.
echo [2/3] Starting server2.py...
start "Tools Backend Server" cmd /k "python server2.py"

echo.
echo [3/3] Starting WhatsApp Bot...
start "WhatsApp Bot" cmd /k "cd wabot && npm start"

echo.
echo All services have been launched in separate windows!
echo You can close this window now.
pause

@echo off
rem Serves the repo locally with the cross-origin-isolation headers the browser OCR needs for
rem multi-threading, then opens the cockpit. No Python / OCR server required.
setlocal
cd /d "%~dp0"
start "Scanner (Browser-OCR)" cmd /k node tests\serve.js 8796
timeout /t 1 >nul
start "" http://127.0.0.1:8796/web-scanner-onnx/

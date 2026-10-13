@echo off
rem Starts the RapidOCR server (server.py) and opens the review UI in the browser.
setlocal
cd /d "%~dp0"

rem Prefer the Python 3.12 launcher, fall back to plain python on PATH.
where py >nul 2>nul && set "PYCMD=py -3.12" || set "PYCMD=python"

start "OCR Server" cmd /k %PYCMD% -m uvicorn server:app --host 127.0.0.1 --port 8795

rem The local API router is needed for scanner sync until the endpoint is deployed to lwhub.de.
curl -fsS http://127.0.0.1:8080/alliances >nul 2>nul || (
    where php >nul 2>nul && start "LWHub API" /D "%~dp0..\api" cmd /k php -S 127.0.0.1:8080 index.php
)

echo Waiting for OCR server...
for /l %%i in 1,1,30 do (
    curl -s http://127.0.0.1:8795/health >nul 2>nul && goto open
    timeout /t 1 >nul
)
echo Server not reachable after 30 s - check the OCR server window.

:open
start "" http://127.0.0.1:8795/

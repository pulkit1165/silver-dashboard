@echo off
REM Silver Industries — Connector + Ngrok launcher
REM Copy to: C:\Users\pulkit\connector2\start-all.bat
REM
REM To wire auto-start (run once in PowerShell on the server):
REM   Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SilverConnector" -Value "cmd /c C:\Users\pulkit\connector2\start-all.bat"

SET ND=C:\Users\pulkit\node16\node-v16.20.2-win-x64
SET C2=C:\Users\pulkit\connector2
SET NGROK=C:\Users\pulkit\ngrok\ngrok.exe
SET LOG=%C2%\autostart.log

echo [%DATE% %TIME%] start-all.bat fired >> "%LOG%"

REM Oracle env vars — connector reads these at startup
SET PATH=%ND%;%PATH%
SET ORACLE_SQLPLUS_PATH=D:\oracle\product\10.2.0\client_1\BIN\sqlplus.exe
SET ORACLE_CONFIG_DIR=D:\oracle\product\10.2.0\client_1\NETWORK\ADMIN
SET ORACLE_USER=SILVER_2026
SET ORACLE_PASSWORD=SILVER_2026
SET ORACLE_CONNECT_STRING=DISH
SET CONNECTOR_PORT=8151

REM Start connector in a minimized window, redirect logs
START "Silver-Connector" /MIN cmd /c ""%ND%\node.exe" "%C2%\serve.mjs" > "%C2%\connector.log" 2> "%C2%\connector-err.log""

echo [%DATE% %TIME%] connector started >> "%LOG%"

REM Wait 4 seconds for connector to bind to port 8151
PING 127.0.0.1 -n 5 > nul

REM Start ngrok with permanent static domain (URL never changes)
START "Silver-Ngrok" /MIN cmd /c ""%NGROK%" http --domain=ashen-tameness-haziness.ngrok-free.dev 8151 > "%C2%\ngrok.log" 2> "%C2%\ngrok-err.log""

echo [%DATE% %TIME%] ngrok started >> "%LOG%"
echo Done. Connector on port 8151, tunnel: https://ashen-tameness-haziness.ngrok-free.dev

@echo off
cd /d D:\connector2

set ORACLE_CLIENT_LIB_DIR=D:\instantclient_19_31\instantclient_19_31
set ORACLE_CONFIG_DIR=D:\app\product\11.2.0\dbhome_1\NETWORK\ADMIN
set ORACLE_USER=SILVER_2026
set ORACLE_PASSWORD=SILVER_2026
set ORACLE_CONNECT_STRING=DISH
set CONNECTOR_PORT=8151

start "SilverConnector" /MIN cmd /c "node serve.mjs > D:\connector2\connector.log 2>&1"

timeout /t 5 /nobreak >nul

start "SilverTunnel" /MIN cmd /c "npx localtunnel --port 8151 > D:\connector2\tunnel.log 2>&1"

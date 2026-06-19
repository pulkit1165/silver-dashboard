@echo off
title Silver Industries - Oracle Connector
echo ==========================================
echo   Silver Industries Data Connector
echo ==========================================
echo.

cd /d D:\silver\silver-dashboard-main\connector

echo [1/2] Installing compatible Oracle driver...
call npm install oracledb@4 --silent

echo [2/2] Starting connector...
set ORACLE_CLIENT_LIB_DIR=D:\app\product\11.2.0\dbhome_1\bin
set ORACLE_CONFIG_DIR=D:\app\product\11.2.0\dbhome_1\NETWORK\ADMIN
set ORACLE_USER=SILVER_2026
set ORACLE_PASSWORD=SILVER_2026
set ORACLE_CONNECT_STRING=DISH
set CONNECTOR_PORT=8088

echo.
echo Connector running on port 8088. DO NOT CLOSE THIS WINDOW.
echo.
node serve.mjs
pause

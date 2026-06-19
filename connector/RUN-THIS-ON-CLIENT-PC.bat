@echo off
echo Starting Oracle config collector...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0collect-oracle-config.ps1"
if %errorlevel% neq 0 (
    echo.
    echo Script failed. Trying alternative method...
    powershell.exe -ExecutionPolicy Bypass -Command "& {. '%~dp0collect-oracle-config.ps1'}"
)
pause

# Silver Up connector auto-start script
# Lives on the server at: C:\Users\pulkit\connector2\autostart.ps1
# Wired to HKCU Run key — fires on pulkit logon (hidden, no console)

$nd   = "C:\Users\pulkit\node16\node-v16.20.2-win-x64"
$c2   = "C:\Users\pulkit\connector2"
$ngrok = "C:\Users\pulkit\ngrok\ngrok.exe"
$log  = "C:\Users\pulkit\connector2\autostart.log"

"[$(Get-Date)] autostart.ps1 fired" | Out-File $log

# Oracle env vars — connector reads these at startup
$env:PATH                 = "$nd;" + $env:PATH
$env:ORACLE_SQLPLUS_PATH  = "D:\oracle\product\10.2.0\client_1\BIN\sqlplus.exe"
$env:ORACLE_CONFIG_DIR    = "D:\oracle\product\10.2.0\client_1\NETWORK\ADMIN"
$env:ORACLE_USER          = "SILVER_2026"
$env:ORACLE_PASSWORD      = "SILVER_2026"
$env:ORACLE_CONNECT_STRING = "DISH"
$env:CONNECTOR_PORT       = "8151"

# Start connector (inherits env vars set above)
Start-Process -FilePath "$nd\node.exe" `
  -ArgumentList "$c2\serve.mjs" `
  -WorkingDirectory $c2 `
  -WindowStyle Hidden `
  -RedirectStandardOutput "$c2\connector.log" `
  -RedirectStandardError  "$c2\connector-err.log"

"[$(Get-Date)] connector started" | Out-File $log -Append

Start-Sleep 3

# Start ngrok with your permanent static domain
# REPLACE the domain below with your actual ngrok static domain
Start-Process -FilePath $ngrok `
  -ArgumentList "http","--domain=ammonia-margarine-haphazard.ngrok-free.dev","8151" `
  -WindowStyle Hidden `
  -RedirectStandardOutput "$c2\ngrok.log" `
  -RedirectStandardError  "$c2\ngrok-err.log"

"[$(Get-Date)] ngrok started" | Out-File $log -Append

# Run this script as Administrator (right-click -> Run with PowerShell as Admin)
# It does TWO things:
#   1. Adds "73.149.135.125  DISHA-C2" to the Windows hosts file
#   2. Imports the Oracle server cert (CN=DISHA-C2) into LocalMachine\Root

$ErrorActionPreference = "Stop"
$certPem = "C:\Users\Lenovo\Desktop\silver industries\silver-dashboard\certs\DISHA-C2.pem"
$hostsPath = "C:\Windows\System32\drivers\etc\hosts"

Write-Host "=== Oracle TCPS Setup (Admin) ===" -ForegroundColor Cyan

# 1. Add hosts entry
$hostsContent = Get-Content $hostsPath -Raw
if ($hostsContent -notmatch "DISHA-C2") {
    Add-Content -Path $hostsPath -Value "`n73.149.135.125    DISHA-C2" -Encoding ascii
    Write-Host "[OK] Hosts entry added: 73.149.135.125 -> DISHA-C2" -ForegroundColor Green
} else {
    Write-Host "[OK] Hosts entry already present" -ForegroundColor Green
}

# 2. Import cert to LocalMachine\Root
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $certPem
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store "Root","LocalMachine"
$store.Open("ReadWrite")
$alreadyThere = $store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
if (-not $alreadyThere) {
    $store.Add($cert)
    Write-Host "[OK] Cert CN=DISHA-C2 imported to LocalMachine\Root" -ForegroundColor Green
} else {
    Write-Host "[OK] Cert already in LocalMachine\Root" -ForegroundColor Green
}
$store.Close()

Write-Host "`nAll done. You can now run the Oracle connection test." -ForegroundColor Cyan
Read-Host "Press Enter to close"

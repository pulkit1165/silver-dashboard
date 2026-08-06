# Silver ERP - Print Agent (pure PowerShell). Installed & started by install.bat.
# Reads its token from config.json, then loops forever: heartbeat the printers,
# pull label jobs, print them raw. Self-heals (never exits) and logs to agent.log.

$ErrorActionPreference = "Continue"
$BaseUrl = "https://silver-dashboard-eight.vercel.app"
$Filter  = "TSC"
$Dir     = Join-Path $env:LOCALAPPDATA "SilverPrintAgent"
$LogFile = Join-Path $Dir "agent.log"

function Log([string]$m) {
  $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $m
  try { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue } catch {}
  Write-Host $line
}

# keep the log from growing forever
try { if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 200kb)) { Clear-Content $LogFile } } catch {}

$cfg = Get-Content (Join-Path $Dir "config.json") -Raw | ConvertFrom-Json
$Token = ("" + $cfg.token).Trim()
$Pc    = $env:COMPUTERNAME
Log "=== agent starting on $Pc (base $BaseUrl) ==="
if ([string]::IsNullOrWhiteSpace($Token)) { Log "NO TOKEN in config.json - stopping"; exit 1 }

# Win32 raw-print helper. If it fails to compile we still heartbeat (printing off).
$RawOk = $true
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFOW { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFOW di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, IntPtr buf, int count, out int written);
  public static void Send(string printer, byte[] bytes) {
    IntPtr hp;
    if (!OpenPrinter(printer, out hp, IntPtr.Zero)) throw new Exception("OpenPrinter failed (" + Marshal.GetLastWin32Error() + ") for '" + printer + "'");
    try {
      DOCINFOW di = new DOCINFOW(); di.pDocName = "Silver Label"; di.pDataType = "RAW";
      if (!StartDocPrinter(hp, 1, ref di)) throw new Exception("StartDocPrinter failed (" + Marshal.GetLastWin32Error() + ")");
      try { StartPagePrinter(hp);
        IntPtr p = Marshal.AllocHGlobal(bytes.Length);
        try { Marshal.Copy(bytes, 0, p, bytes.Length); int w; if (!WritePrinter(hp, p, bytes.Length, out w)) throw new Exception("WritePrinter failed (" + Marshal.GetLastWin32Error() + ")"); }
        finally { Marshal.FreeHGlobal(p); }
        EndPagePrinter(hp);
      } finally { EndDocPrinter(hp); }
    } finally { ClosePrinter(hp); }
  }
}
"@
} catch { $RawOk = $false; Log ("Add-Type failed (printing disabled): " + $_.Exception.Message) }

function Post($path, $body) {
  $json = $body | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri "$BaseUrl$path" -Method Post -Body $json -ContentType "application/json" -Headers @{ "x-agent-token" = $Token } -TimeoutSec 20
}

# Force TLS 1.2 (older Windows defaults to TLS 1.0 and fails HTTPS to Vercel).
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$tick = 0
while ($true) {
  try {
    if ($tick % 12 -eq 0) {
      $printers = @(Get-Printer | Where-Object { $_.Name -like "*$Filter*" } | Select-Object -ExpandProperty Name)
      Post "/api/erp/print/agent/heartbeat" @{ pc = $Pc; printers = $printers } | Out-Null
      Log ("heartbeat OK  printers=[" + ($printers -join ", ") + "]")
    }
    $r = Post "/api/erp/print/agent/pull" @{ pc = $Pc; limit = 10 }
    foreach ($j in @($r.jobs)) {
      try {
        if (-not $RawOk) { throw "raw printing unavailable on this PC" }
        $bytes = [Convert]::FromBase64String($j.tspl_b64)
        [RawPrinter]::Send($j.name, $bytes)
        Post "/api/erp/print/agent/ack" @{ id = $j.id; ok = $true } | Out-Null
        Log ("printed job " + $j.id + " -> " + $j.name)
      } catch {
        try { Post "/api/erp/print/agent/ack" @{ id = $j.id; ok = $false; error = "$_" } | Out-Null } catch {}
        Log ("job " + $j.id + " FAILED: " + $_)
      }
    }
  } catch {
    Log ("loop error: " + $_.Exception.Message)
    Start-Sleep -Seconds 3
  }
  Start-Sleep -Milliseconds 2500
  $tick++
}

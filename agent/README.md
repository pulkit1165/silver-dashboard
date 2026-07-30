# Silver ERP — self-hosted print agent (PrintNode replacement)

A tiny agent that runs on each Windows PC with TSC label printers. It **polls the
ERP app over HTTPS** (outbound only — no tunnel, no port-forward, no changing URL),
claims queued label jobs for that PC's printers, and prints the **raw TSPL** via the
Windows spooler. This replaces the paid PrintNode service.

```
Web app (Vercel)  ──enqueue──►  print_jobs (Neon Postgres)
                                      ▲   │ claim (poll every 1s)
                                      │   ▼
                              this agent ──► rawprint.ps1 ──► USB TSC printer
```

## One-time server setup (already deployed)
Set a shared secret on Vercel so only your agents can pull jobs:

- Vercel → Project → Settings → Environment Variables → add **`PRINT_AGENT_TOKEN`**
  = a long random string (e.g. run `openssl rand -hex 24`). Redeploy.

## Install on each ERP PC (USB printer attached)
You already have portable Node 16 on the connector box
(`C:\Users\pulkit\node16\node-v16.20.2-win-x64\node.exe`) — the agent works on
Node 16+.

1. Copy this whole `agent\` folder onto the PC, e.g. `C:\silver-agent\`.
2. Copy `config.example.json` → `config.json` and fill in:
   - `baseUrl`  — your app URL (default is already correct).
   - `token`    — the **same** value as `PRINT_AGENT_TOKEN` on Vercel.
   - `printerFilter` — `"TSC"` auto-serves any printer whose name contains "TSC".
     Or hard-list them: `"printers": ["TSC TTP-244 Plus", "TSC TTP-345"]`.
3. Run it:
   ```
   "C:\Users\pulkit\node16\node-v16.20.2-win-x64\node.exe" C:\silver-agent\print-agent.mjs
   ```
   You should see `serving: TSC TTP-244 Plus ...` and `running. Polling …`.
4. In the ERP **Print Barcode Labels** page, switch the print engine to **Direct
   (our bridge)** — your PC's printers now appear in the dropdown. Print a test label.

## Auto-start on login (survives disconnect; no admin needed)
`start-agent.ps1` launches it hidden. Register it under the current user's Run key:

```powershell
$node  = "C:\Users\pulkit\node16\node-v16.20.2-win-x64\node.exe"
$agent = "C:\silver-agent\print-agent.mjs"
$cmd   = "powershell -WindowStyle Hidden -Command `"& '$node' '$agent'`""
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SilverPrintAgent" -Value $cmd
```

## How raw printing works
`rawprint.ps1` opens the printer via the Win32 spooler (`OpenPrinter` /
`StartDocPrinter` with datatype **RAW** / `WritePrinter`) and sends the bytes
untouched — identical in spirit to PrintNode's `raw_base64`. No printer driver
setting can reinterpret the TSPL.

## Troubleshooting
- **Printer not in the dropdown** → agent isn't heartbeating. Check the console for
  errors, confirm `token` matches Vercel, and that the printer name contains "TSC"
  (or is listed in `config.printers`).
- **Job stuck at "printing"** → the app auto-requeues jobs a dead agent left after
  120s. Restart the agent.
- **`OpenPrinter failed (5)`** → access denied; run the agent as the user who owns
  the printer, or grant print permission.
- **Nothing prints, no error** → the printer name in Windows must match exactly;
  print a Windows test page first to confirm the driver/USB link.

# Launches the Silver print agent hidden. Edit the two paths if you installed
# Node or the agent somewhere else. Register this with the Run key (see README).
$node  = "C:\Users\pulkit\node16\node-v16.20.2-win-x64\node.exe"
$agent = Join-Path $PSScriptRoot "print-agent.mjs"
& $node $agent

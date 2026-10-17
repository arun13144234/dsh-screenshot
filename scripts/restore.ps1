# Safety net for the capture helper: if the capture process dies before its own
# finally block runs, the window it hid would stay hidden. The caller writes the
# window handle to a record file before hiding, and this script undoes it.
[CmdletBinding()]
param([string]$TargetFile = '')

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshShotRestore {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
'@

if ([string]::IsNullOrEmpty($TargetFile) -or -not (Test-Path -LiteralPath $TargetFile)) {
  [Console]::Out.WriteLine('{"restored":false,"reason":"no record"}')
  return
}

$raw = (Get-Content -LiteralPath $TargetFile -Raw).Trim()
$value = [Int64]0
if (-not [Int64]::TryParse($raw, [ref]$value)) {
  [Console]::Out.WriteLine('{"restored":false,"reason":"bad record"}')
  return
}
$handle = [IntPtr]$value
if ($handle -eq [IntPtr]::Zero -or -not [DshShotRestore]::IsWindow($handle)) {
  [Console]::Out.WriteLine('{"restored":false,"reason":"window gone"}')
  return
}

[void][DshShotRestore]::ShowWindow($handle, 9)
[void][DshShotRestore]::SetForegroundWindow($handle)
[Console]::Out.WriteLine('{"restored":true}')

# dsh-screenshot capture driver.
#
# Compiles DshShot.cs on demand, runs one capture, and prints exactly one JSON
# line on stdout:
#   {"ok":true,"path":"...","reason":"","message":"","width":W,"height":H}
#   {"ok":false,"path":"","reason":"cancelled"|"failed","message":"...","width":0,"height":0}
#
# Exit code is always 0 for an answered capture; a nonzero exit means the driver
# itself broke and the caller must treat stderr as the reason.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutPath,
  [int]$TimeoutSeconds = 120,
  [string]$TargetFile = '',
  [string]$AutoSelect = '',
  [string]$TitleFragment = '',
  [string]$SourceDir = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ([string]::IsNullOrEmpty($SourceDir)) { $SourceDir = $PSScriptRoot }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$source = Join-Path $SourceDir 'DshShot.cs'
if (-not (Test-Path -LiteralPath $source)) { throw "missing $source" }

# Add-Type -Path compiles against a bare reference set; point it at the drawing
# and forms assemblies actually loaded above so the usings resolve.
$references = @(
  [System.Drawing.Bitmap].Assembly.Location
  [System.Windows.Forms.Form].Assembly.Location
)
Add-Type -Path $source -ReferencedAssemblies $references

$json = [DshShot]::RunJson($OutPath, $TimeoutSeconds, $TargetFile, $AutoSelect, $TitleFragment)
[Console]::Out.WriteLine($json)

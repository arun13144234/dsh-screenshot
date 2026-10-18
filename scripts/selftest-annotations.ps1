# Programmatic self-test for the annotation stage of DshShot.Selector.
# Drives the real message pipeline (SendMessage with WM_LBUTTON*) so the test
# exercises the same code a mouse does, then ticks the toolbar and inspects the
# composited result: a 300x200 crop containing red annotation pixels.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
$references = @(
  [System.Drawing.Bitmap].Assembly.Location
  [System.Windows.Forms.Form].Assembly.Location
)
Add-Type -Path (Join-Path $PSScriptRoot 'DshShot.cs') -ReferencedAssemblies $references
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshShotTestInput {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
  public static void Down(IntPtr h, int x, int y) { SendMessage(h, 0x0201, new IntPtr(1), Pack(x, y)); }
  public static void Move(IntPtr h, int x, int y) { SendMessage(h, 0x0200, new IntPtr(1), Pack(x, y)); }
  public static void Up(IntPtr h, int x, int y) { SendMessage(h, 0x0202, IntPtr.Zero, Pack(x, y)); }
  static IntPtr Pack(int x, int y) { return new IntPtr((y << 16) | (x & 0xFFFF)); }
}
'@

$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$frozen = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
$g = [System.Drawing.Graphics]::FromImage($frozen)
$g.Clear([System.Drawing.Color]::FromArgb(40, 60, 80))
$g.Dispose()

$form = New-Object 'DshShot+Selector'($frozen, $vs, 25)
$flags = [System.Reflection.BindingFlags]'Instance,NonPublic,Public'
$type = $form.GetType()

function Note([string]$text) { [Console]::WriteLine($text) }

$script:step = 0
$script:failed = $false
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
  $script:step++
  try {
    $handle = $form.Handle
    switch ($script:step) {
      1 {
        [DshShotTestInput]::Down($handle, 100, 100)
        [DshShotTestInput]::Move($handle, 250, 200)
        [DshShotTestInput]::Move($handle, 400, 300)
        [DshShotTestInput]::Up($handle, 400, 300)
        $editing = $type.GetField('editing', $flags).GetValue($form)
        $visible = ($form.Controls | Where-Object { $_.Visible }).Count
        Note ("step1 selection=" + $form.Selection + " editing=" + $editing + " visibleButtons=" + $visible)
      }
      2 {
        [DshShotTestInput]::Down($handle, 150, 150)
        [DshShotTestInput]::Move($handle, 350, 250)
        [DshShotTestInput]::Up($handle, 350, 250)
        Note ("step2 annotations=" + $type.GetField('annotations', $flags).GetValue($form).Count)
      }
      3 {
        $arrow = $form.Controls | Where-Object { $_.Text -eq ([char]0x2197).ToString() } | Select-Object -First 1
        if ($arrow) { $arrow.PerformClick() }
        [DshShotTestInput]::Down($handle, 200, 220)
        [DshShotTestInput]::Move($handle, 380, 160)
        [DshShotTestInput]::Up($handle, 380, 160)
        Note ("step3 annotations=" + $type.GetField('annotations', $flags).GetValue($form).Count)
      }
      4 {
        $confirm = $form.Controls | Where-Object { $_.Text -eq ([char]0x2713).ToString() } | Select-Object -First 1
        if (-not $confirm) { throw 'confirm button not found' }
        $confirm.PerformClick()
      }
    }
  } catch {
    Note ("TICK ERROR step " + $script:step + ": " + $_.Exception.Message)
    $script:failed = $true
    $timer.Stop()
    $form.Close()
  }
})
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
$timer.Stop()

if ($script:failed) { throw 'self-test aborted before the toolbar was used' }
if ($null -eq $form.Result) { throw 'no result bitmap' }
Note ("result " + $form.Result.Width + 'x' + $form.Result.Height + " cancelled=" + $form.Cancelled)

$red = 0
for ($x = 0; $x -lt $form.Result.Width; $x += 2) {
  for ($y = 0; $y -lt $form.Result.Height; $y += 2) {
    $p = $form.Result.GetPixel($x, $y)
    if ($p.R -gt 150 -and $p.G -lt 120) { $red++ }
  }
}
Note ("red pixels sampled: " + $red)
$form.Result.Save((Join-Path $env:TEMP 'dsh-screenshot-selftest.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$form.Result.Dispose()
$frozen.Dispose()
if ($red -gt 100) { Note 'SELFTEST OK' } else { Note 'SELFTEST FAIL: no annotation pixels' }

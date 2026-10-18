# Launches the Team Tour Launcher GUI against a fake Balatro dir and saves a screenshot of its window.
# Usage: powershell -File capture-window.ps1 -Exe <exe> -AppData <dir containing Balatro\> -Out <png> [-ExtraArgs --font-scale,1.5]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$AppData,
  [Parameter(Mandatory = $true)][string]$Out,
  [string[]]$ExtraArgs = @()
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
[void][Win32]::SetProcessDPIAware()

$p = Start-Process -FilePath $Exe -ArgumentList (@("--appdata", "`"$AppData`"", "--no-launch") + $ExtraArgs) -PassThru
try {
  $deadline = (Get-Date).AddSeconds(20)
  while ($p.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $p.Refresh()
  }
  if ($p.MainWindowHandle -eq 0) { throw "the launcher window never appeared" }
  [void][Win32]::SetForegroundWindow($p.MainWindowHandle)
  Start-Sleep -Seconds 2
  $r = New-Object Win32+RECT
  [void][Win32]::GetWindowRect($p.MainWindowHandle, [ref]$r)
  $w = $r.Right - $r.Left
  $h = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "captured ${w}x${h} to $Out"
} finally {
  if (-not $p.HasExited) { $p.Kill() }
}

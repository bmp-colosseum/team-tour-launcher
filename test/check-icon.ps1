# Fails unless the exe carries an icon resource (what Explorer and the taskbar show).
param([Parameter(Mandatory = $true)][string]$Exe)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Exe)
if ($null -eq $icon) { throw "no icon extracted from $Exe" }
Write-Host "icon size: $($icon.Width)x$($icon.Height)"
if ($icon.Width -lt 32 -or $icon.Height -lt 32) { throw "icon is smaller than 32px" }
# A generic exe icon would also be non-null, so compare against the icon of a known system exe.
$generic = [System.Drawing.Icon]::ExtractAssociatedIcon("$env:WINDIR\System32\attrib.exe")
$ours = New-Object System.IO.MemoryStream
$icon.ToBitmap().Save($ours, [System.Drawing.Imaging.ImageFormat]::Png)
$theirs = New-Object System.IO.MemoryStream
$generic.ToBitmap().Save($theirs, [System.Drawing.Imaging.ImageFormat]::Png)
if ([System.Convert]::ToBase64String($ours.ToArray()) -eq [System.Convert]::ToBase64String($theirs.ToArray())) {
  throw "the exe shows the generic icon, not the embedded one"
}
Write-Host "exe has its own icon"

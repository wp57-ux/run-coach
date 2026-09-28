# Draws the app icons: a treadmill-console dot-matrix profile.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1

Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $out | Out-Null

$bg    = [System.Drawing.ColorTranslator]::FromHtml('#0c0e0d')
$ghost = [System.Drawing.ColorTranslator]::FromHtml('#1f2522')
$fill  = @{
  r = [System.Drawing.ColorTranslator]::FromHtml('#c9f23a')
  w = [System.Drawing.ColorTranslator]::FromHtml('#4d8dff')
  e = [System.Drawing.ColorTranslator]::FromHtml('#8b9aa7')
}
# warm-up, walk, run, run, walk, run, run
$types   = @('e', 'w', 'r', 'r', 'w', 'r', 'r')
$heights = @(2, 3, 7, 7, 3, 7, 7)

function New-Icon([int]$size, [double]$scale, [string]$file) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear($bg)
  $area = $size * $scale
  $pitch = $area / 7
  $dot = $pitch * 0.74
  $x0 = ($size - $area) / 2
  $y0 = ($size - $area) / 2
  for ($c = 0; $c -lt 7; $c++) {
    for ($r = 0; $r -lt 7; $r++) {
      $lit = (6 - $r) -lt $heights[$c]
      $color = if ($lit) { $fill[$types[$c]] } else { $ghost }
      $brush = New-Object System.Drawing.SolidBrush $color
      $g.FillEllipse($brush, [float]($x0 + $c * $pitch + ($pitch - $dot) / 2), [float]($y0 + $r * $pitch + ($pitch - $dot) / 2), [float]$dot, [float]$dot)
      $brush.Dispose()
    }
  }
  $g.Dispose()
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "$file ($size px)"
}

New-Icon 192 0.72 'icon-192.png'
New-Icon 512 0.72 'icon-512.png'
New-Icon 512 0.56 'icon-maskable-512.png'

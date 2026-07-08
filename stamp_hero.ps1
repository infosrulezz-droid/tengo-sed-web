Add-Type -AssemblyName System.Drawing

$project = "C:\Users\LAPMAC CHILE\Desktop\tengo-sed-FINAL"
$heroDir = "$project\hero_slides"
$logoSrc = "$project\logo.jpg"
$dl      = "C:\Users\LAPMAC CHILE\Downloads"

$sources = @(
  [PSCustomObject]@{ src="$dl\ChatGPT Image 22 jun 2026, 20_50_11.png"; out="$heroDir\slide_0.png"; lbl="Pack Mundial" }
  [PSCustomObject]@{ src="$dl\ChatGPT Image 7 jun 2026, 22_58_49.png";  out="$heroDir\slide_1.png"; lbl="Tengo Sed sunset" }
  [PSCustomObject]@{ src="$dl\ChatGPT Image 4 jun 2026, 22_36_23.png";  out="$heroDir\slide_2.png"; lbl="Ballantines FIFA" }
  [PSCustomObject]@{ src="$dl\ChatGPT Image 4 jun 2026, 22_26_14.png";  out="$heroDir\slide_3.png"; lbl="Alto del Carmen Pisco" }
  [PSCustomObject]@{ src="$dl\ChatGPT Image 23 jun 2026, 02_13_23.png"; out="$heroDir\slide_4.png"; lbl="Magic Moment Vodka" }
)

foreach ($item in $sources) {
    $src   = [System.Drawing.Image]::FromFile($item.src)
    $W     = $src.Width
    $H     = $src.Height
    $bmp   = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g     = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Draw base image
    $g.DrawImage($src, 0, 0, $W, $H)

    # ── TENGO SED LOGO (top-left) ──
    $logo  = [System.Drawing.Image]::FromFile($logoSrc)
    $logoH = [int]($H * 0.13)
    $logoW = [int]($logo.Width * $logoH / $logo.Height)
    $pad   = [int]($W * 0.015)
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 0, 0, 0))
    $g.FillRectangle($bgBrush, ($pad - 6), ($pad - 6), ($logoW + 12), ($logoH + 12))
    $bgBrush.Dispose()
    $g.DrawImage($logo, $pad, $pad, $logoW, $logoH)
    $logo.Dispose()

    # ── MINSAL WARNING BAR (bottom) ──
    $stripH  = [int]($H * 0.022)
    $barH    = [int]($H * 0.18)
    $barY    = $H - $barH
    $textH   = $barH - ($stripH * 2)

    $blkBrush  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
    $blueBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 56, 168))
    $redBrush  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(213, 43, 30))

    $g.FillRectangle($blkBrush,  0, $barY,              $W, $textH)
    $g.FillRectangle($blueBrush, 0, ($H - $stripH * 2), $W, $stripH)
    $g.FillRectangle($redBrush,  0, ($H - $stripH),     $W, $stripH)

    $blkBrush.Dispose()
    $blueBrush.Dispose()
    $redBrush.Dispose()

    # Text
    $white   = [System.Drawing.Brushes]::White
    $tPad    = [int]($W * 0.022)
    $fs1     = [int]($W * 0.022)
    $fs2     = [int]($W * 0.016)
    $fBold   = New-Object System.Drawing.Font("Arial", $fs1, [System.Drawing.FontStyle]::Bold)
    $fNorm   = New-Object System.Drawing.Font("Arial", $fs2)
    $fSmBold = New-Object System.Drawing.Font("Arial", $fs2, [System.Drawing.FontStyle]::Bold)
    $lineH   = [int]($fBold.GetHeight($g)) + 6
    $textY   = $barY + [int]($textH * 0.08)

    $g.DrawString("ADVERTENCIA",                                                                    $fBold,   $white, $tPad, $textY)
    $g.DrawString("El consumo de alcohol en menores de 18 anos se encuentra prohibido.",            $fNorm,   $white, $tPad, ($textY + $lineH))
    $g.DrawString("No beber alcohol durante el embarazo.",                                          $fNorm,   $white, $tPad, ($textY + $lineH * 2))
    $g.DrawString("MINISTERIO DE SALUD",                                                            $fSmBold, $white, $tPad, ($textY + $lineH * 3))

    $fBold.Dispose()
    $fNorm.Dispose()
    $fSmBold.Dispose()
    $g.Dispose()
    $src.Dispose()

    $bmp.Save($item.out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    Write-Host "Done: $($item.lbl) -> $($item.out)"
}

Write-Host "All 5 slides stamped."

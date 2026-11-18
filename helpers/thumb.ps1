# cc-img's Windows helper. Each run does one thing, picked by its arguments:
#
#   thumb.ps1 -Src <image> -OutDir <folder> -Id <name> [-Width 80] [-Height 80] [-Across 2] [-Png 1]
#       reads one image with the image library Windows ships and writes
#       <OutDir>\<Id>.bmp (uncompressed), which the mod can parse without a
#       decoder, and, with -Png 1, <OutDir>\<Id>.png (at most 480 x 480);
#       prints {"w":<width>,"h":<height>}, the original's size.
#       The BMP is the picture fitted to <Width> by <Height> pixels, aspect
#       kept, never enlarged, and then written <Across> pixels for each one
#       across: 2 where the mod draws pixels half as wide as tall.
#       With -SixId <name> [-SixW 400] [-SixH 400] it also writes
#       <OutDir>\<name>.six.bmp, the picture fitted to <SixW> by <SixH>, and
#       adds ,"sw":<width>,"sh":<height>, that file's size, to what it prints.
#   thumb.ps1 -FromStdin <file>
#       writes the base64 on stdin to <file> as bytes.
#   thumb.ps1 -Open <file>
#       opens <file> in its default app.
#   thumb.ps1 -MakeDir <folder>
#       makes <folder>.
#   thumb.ps1 -RemoveDir <folder>
#       deletes <folder>, only if it is one of the mod's own session folders.
#
# Every path is taken literally, as one argument: nothing here is handed to a
# shell, so a name holding `&`, `,` or a quote does nothing but name a file.
#
# Exit code 0 on success, 1 on any failure. Nothing else is printed.
param(
  [string]$Src,
  [string]$OutDir,
  [string]$Id,
  [string]$Png = '0',
  [int]$Width = 80,
  [int]$Height = 80,
  [int]$Across = 2,
  [string]$SixId,
  [int]$SixW = 400,
  [int]$SixH = 400,
  [string]$FromStdin,
  [string]$Open,
  [string]$MakeDir,
  [string]$RemoveDir
)

$ErrorActionPreference = 'Stop'

# Run by a Claude Code that was started from PowerShell 7 (in a herdr pane, for
# one), this Windows PowerShell inherits PowerShell 7's module path, and some
# of its own commands then cannot load. Its own path comes first.
$own = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
$env:PSModulePath = if ($own) { $own } else { [System.IO.Path]::Combine($PSHOME, 'Modules') }

function Resize([System.Drawing.Image]$Image, [double]$MaxWidth, [double]$MaxHeight, [int]$Across = 1) {
  $scale = [Math]::Min([Math]::Min($MaxWidth / $Image.Width, $MaxHeight / $Image.Height), 1.0)
  # $Across pixels are written for each one across that fits.
  $width = [Math]::Max(1, [int][Math]::Floor($Image.Width * $scale)) * $Across
  $height = [Math]::Max(1, [int][Math]::Floor($Image.Height * $scale))

  $bitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    # A mid grey shows through transparency, so a white logo and a black one both read.
    $graphics.Clear([System.Drawing.Color]::FromArgb(128, 128, 128))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $attributes = New-Object System.Drawing.Imaging.ImageAttributes
    # Without this the edge pixels are blended with nothing and come out dark.
    $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $target = New-Object System.Drawing.Rectangle 0, 0, $width, $height
    $graphics.DrawImage($Image, $target, 0, 0, $Image.Width, $Image.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
    $attributes.Dispose()
  }
  finally {
    $graphics.Dispose()
  }

  return $bitmap
}

try {
  if ($FromStdin) {
    $text = [Console]::In.ReadToEnd()
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($FromStdin)) | Out-Null
    [System.IO.File]::WriteAllBytes($FromStdin, [Convert]::FromBase64String($text.Trim()))
    exit 0
  }

  if ($Open) {
    # Only a file that is there is opened, and by its literal path.
    if (-not [System.IO.File]::Exists($Open)) { exit 1 }
    Invoke-Item -LiteralPath $Open
    exit 0
  }

  if ($MakeDir) {
    [System.IO.Directory]::CreateDirectory($MakeDir) | Out-Null
    exit 0
  }

  if ($RemoveDir) {
    # Only <anything>\cc-img\s<digits>: a session folder this mod made.
    $folder = New-Object System.IO.DirectoryInfo $RemoveDir
    if ($folder.Name -notmatch '^s\d+$' -or $null -eq $folder.Parent -or $folder.Parent.Name -ne 'cc-img') { exit 1 }
    if ($folder.Exists) { $folder.Delete($true) }
    exit 0
  }

  Add-Type -AssemblyName System.Drawing
  [System.IO.Directory]::CreateDirectory($OutDir) | Out-Null

  # The file is read whole and closed at once. Image.FromFile would keep it
  # locked while the thumbnail is made, and a tool call that rewrites or
  # deletes the same file in that moment would fail.
  $stream = New-Object System.IO.MemoryStream (, [System.IO.File]::ReadAllBytes($Src))
  $image = $null
  try {
    $image = [System.Drawing.Image]::FromStream($stream)

    # A camera stores a turned photo unturned, with the turn in tag 0x0112.
    if ($image.PropertyIdList -contains 0x0112) {
      $turn = switch ($image.GetPropertyItem(0x0112).Value[0]) {
        3 { [System.Drawing.RotateFlipType]::Rotate180FlipNone }
        6 { [System.Drawing.RotateFlipType]::Rotate90FlipNone }
        8 { [System.Drawing.RotateFlipType]::Rotate270FlipNone }
        default { $null }
      }
      if ($null -ne $turn) { $image.RotateFlip($turn) }
    }

    $boxWidth = [Math]::Min([Math]::Max($Width, 1), 1024)
    $boxHeight = [Math]::Min([Math]::Max($Height, 1), 1024)
    $small = Resize $image $boxWidth $boxHeight ([Math]::Min([Math]::Max($Across, 1), 2))
    try { $small.Save((Join-Path $OutDir "$Id.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp) }
    finally { $small.Dispose() }

    if ($Png -eq '1') {
      $preview = Resize $image 480 480
      try { $preview.Save((Join-Path $OutDir "$Id.png"), [System.Drawing.Imaging.ImageFormat]::Png) }
      finally { $preview.Dispose() }
    }

    $six = ''
    if ($SixId) {
      # The picture at the size the Sixel painter draws it, for helpers\sixel.cs.
      $full = Resize $image ([Math]::Min([Math]::Max($SixW, 1), 2048)) ([Math]::Min([Math]::Max($SixH, 1), 2048))
      try {
        $full.Save((Join-Path $OutDir "$SixId.six.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
        $six = ',"sw":' + $full.Width + ',"sh":' + $full.Height
      }
      finally { $full.Dispose() }
    }

    [Console]::Out.Write('{"w":' + $image.Width + ',"h":' + $image.Height + $six + '}')
  }
  finally {
    if ($null -ne $image) { $image.Dispose() }
    $stream.Dispose()
  }
  exit 0
}
catch {
  exit 1
}

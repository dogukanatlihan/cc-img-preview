# cc-img's Sixel painter, started once a Claude Code session. See sixel.cs.
#
#   sixel.ps1 -Start -Dir <folder> [-Screen claude|herdr]
#       makes sure a painter of this version runs in the background for each
#       screen pictures are to be painted on, and prints
#       {"ok":true,"consoles":[<process>,...],"started":<how many were started>}.
#       -Screen claude (the default): the screen of the Claude Code session this
#       was run from, in Windows Terminal.
#       -Screen herdr: the screen of every herdr window that runs in Windows
#       Terminal. herdr passes no Sixel on, but the screen of the herdr window
#       itself is Windows Terminal's: the painter finds the picture rows there,
#       wherever herdr has put the pane, and paints past herdr.
#       A painter of another version (an earlier copy of sixel.cs) is asked to
#       end first, and this one takes its place. Painters are started outside
#       this process's tree. Each ends when the process whose screen it paints
#       on does, when <folder> is deleted, or when a file named `stop` or
#       `stop-<that process>` appears in <folder>.
#   sixel.ps1 -Watch -Dir <folder> -ConsolePid <process> -Version <name>
#       is the painter itself: it paints <folder>\<id>.six.bmp over the rows
#       of that process's screen that carry the picture's markers.
#
# What goes wrong is written to <folder>\sixel.log.
# Exit code 0 on success, 1 on any failure (no screen to paint on, included).
param(
  [switch]$Start,
  [switch]$Watch,
  [string]$Dir,
  [ValidateSet('claude', 'herdr')]
  [string]$Screen = 'claude',
  [int]$ConsolePid,
  [string]$Version = 'none'
)

$ErrorActionPreference = 'Stop'

# Run by a Claude Code that was started from PowerShell 7 (in a herdr pane, for
# one), this Windows PowerShell inherits PowerShell 7's module path, and some
# of its own commands (Get-FileHash) then cannot load. Its own path comes first.
$own = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
$env:PSModulePath = if ($own) { $own } else { [System.IO.Path]::Combine($PSHOME, 'Modules') }

# What went wrong is written where the painter writes: nobody sees this process.
function Note([string]$Line) {
  try {
    $stamp = (Get-Date).ToString('HH:mm:ss.fff')
    [System.IO.File]::AppendAllText((Join-Path $Dir.TrimEnd('\', '/') 'sixel.log'), "$stamp $Line`r`n")
  }
  catch { }
}

# Makes sure a painter of version $Wanted paints on the screen of process $Owner;
# whether one was started for it.
function Ensure([int]$Owner, [string]$Folder, [string]$Wanted) {
  $versionFile = [CcImg.Watcher]::VersionFile($Folder, $Owner)
  $stopFile = [CcImg.Watcher]::StopFile($Folder, $Owner)

  if ([CcImg.Watcher]::IsRunning($Owner)) {
    $running = if (Test-Path -LiteralPath $versionFile) { [System.IO.File]::ReadAllText($versionFile).Trim() } else { '' }
    if ($running -eq $Wanted) { return $false }
    # Another version runs: it is asked to end, and waited for.
    [System.IO.File]::WriteAllText($stopFile, '')
    for ($waited = 0; $waited -lt 30 -and [CcImg.Watcher]::IsRunning($Owner); $waited++) { Start-Sleep -Milliseconds 100 }
    if ([CcImg.Watcher]::IsRunning($Owner)) { Note "start failed: the painter of version '$running' for $Owner did not end" }
  }
  if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile -Force }
  if ([CcImg.Watcher]::IsRunning($Owner)) { throw "a painter for $Owner still runs" }

  # Each path is quoted whole: it may hold spaces.
  $line = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Watch -Dir "{1}" -ConsolePid {2} -Version {3}' -f $PSCommandPath, $Folder, $Owner, $Wanted
  # Started by Windows itself, not as a child of this process: Claude Code
  # ends what is left of a command it ran, and the painter has to outlive it.
  $hidden = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $made = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line; ProcessStartupInformation = $hidden }
  if ($made.ReturnValue -ne 0) { throw "Windows answered $($made.ReturnValue)" }
  Note "start asked for console $Owner ($Screen) by process $PID; painter is process $($made.ProcessId), version $Wanted"
  return $true
}

try {
  $source = Join-Path $PSScriptRoot 'sixel.cs'
  Add-Type -AssemblyName System.Drawing
  Add-Type -Path $source -ReferencedAssemblies System.Drawing

  if ($Watch) {
    [CcImg.Watcher]::Run($Dir, $ConsolePid, $Version)
    exit 0
  }

  if ($Start) {
    $owners = if ($Screen -eq 'herdr') {
      @([CcImg.Native]::FindUnder('herdr', 'WindowsTerminal'))
    }
    else {
      @([CcImg.Native]::FindAncestor('claude') | Where-Object { $_ -ne 0 })
    }
    if ($owners.Count -eq 0) {
      $why = if ($Screen -eq 'herdr') { 'no herdr window runs in Windows Terminal' } else { 'not run from Claude Code' }
      Note "start failed: $why"
      [Console]::Out.Write(('{{"ok":false,"why":"{0}"}}' -f $why))
      exit 1
    }

    $folder = $Dir.TrimEnd('\', '/')
    if ($PSCommandPath.Contains('"') -or $folder.Contains('"')) { Note 'start failed: a path holds a quote'; exit 1 }
    [System.IO.Directory]::CreateDirectory($folder) | Out-Null
    # The painter's version is what its code is: a changed sixel.cs is another painter.
    $wanted = [CcImg.Watcher]::VersionOf($source)

    $started = 0
    foreach ($owner in $owners) {
      if (Ensure $owner $folder $wanted) { $started++ }
    }
    [Console]::Out.Write(('{{"ok":true,"consoles":[{0}],"started":{1}}}' -f ($owners -join ','), $started))
    exit 0
  }

  exit 1
}
catch {
  Note "$(if ($Watch) { 'painter' } else { 'start' }) failed: $($_.Exception.Message)"
  exit 1
}

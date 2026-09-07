# Extract .tools\cloudflared.rar -> .tools\cloudflared.exe
$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
} catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolsDir = Join-Path $Root '.tools'
$RarPath = Join-Path $ToolsDir 'cloudflared.rar'
$ExePath = Join-Path $ToolsDir 'cloudflared.exe'

function Write-Step([string]$msg) {
  Write-Host "[setup] $msg"
}

function Download-WithProgress([string]$Url, [string]$OutFile) {
  Write-Step "下载 $Url"
  $req = [System.Net.HttpWebRequest]::Create($Url)
  $req.Timeout = 120000
  $req.ReadWriteTimeout = 600000
  $resp = $req.GetResponse()
  try {
    $total = [int64]$resp.ContentLength
    $inStream = $resp.GetResponseStream()
    $outStream = [System.IO.File]::Create($OutFile)
    try {
      $buf = New-Object byte[] 65536
      $readTotal = [int64]0
      $lastPct = -1
      while (($n = $inStream.Read($buf, 0, $buf.Length)) -gt 0) {
        $outStream.Write($buf, 0, $n)
        $readTotal += $n
        if ($total -gt 0) {
          $pct = [int](($readTotal * 100) / $total)
          if ($pct -ge $lastPct + 10 -or $pct -eq 100) {
            $mb = [math]::Round($readTotal / 1MB, 1)
            $tmb = [math]::Round($total / 1MB, 1)
            Write-Host "         $pct%  ($mb / $tmb MB)"
            $lastPct = $pct
          }
        }
      }
    } finally {
      $outStream.Close()
    }
  } finally {
    $resp.Close()
  }
}

function Find-RarTool {
  $names = @('UnRAR.exe', '7z.exe', 'WinRAR.exe')
  $dirs = @(
    (Join-Path $env:ProgramFiles 'WinRAR'),
    (Join-Path ${env:ProgramFiles(x86)} 'WinRAR'),
    (Join-Path $env:ProgramFiles '7-Zip'),
    (Join-Path ${env:ProgramFiles(x86)} '7-Zip'),
    (Join-Path $ToolsDir '7zip')
  )
  foreach ($d in $dirs) {
    if (-not $d) { continue }
    foreach ($n in $names) {
      $p = Join-Path $d $n
      if (Test-Path -LiteralPath $p) { return $p }
    }
  }
  foreach ($cmd in @('unrar', '7z')) {
    $g = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($g -and $g.Source) { return $g.Source }
  }
  return $null
}

function Install-Portable7Zip {
  $destDir = Join-Path $ToolsDir '7zip'
  $existing = Join-Path $destDir '7z.exe'
  if (Test-Path -LiteralPath $existing) { return $existing }

  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $exeName = if ($arch -eq 'arm64') { '7z2409-arm64.exe' } else { '7z2409-x64.exe' }
  $url = "https://www.7-zip.org/a/$exeName"
  $tmp = Join-Path $env:TEMP "lianji-$exeName"

  Write-Step '本机未找到 WinRAR / 7-Zip，正在下载 7-Zip（仅用于解压 rar）...'
  Download-WithProgress $url $tmp
  if (-not (Test-Path -LiteralPath $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  }
  Write-Step "静默安装 7-Zip 到 $destDir"
  $p = Start-Process -FilePath $tmp -ArgumentList @('/S', "/D=$destDir") -Wait -PassThru
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $existing)) {
    throw "7-Zip 安装失败（exit $($p.ExitCode)），请手动安装 WinRAR 或 7-Zip 后重试"
  }
  Write-Step '7-Zip 已就绪'
  return $existing
}

function Invoke-Extract([string]$Tool, [string]$Rar, [string]$DestDir) {
  $name = [IO.Path]::GetFileName($Tool).ToLowerInvariant()
  Write-Step "使用 $name 解压..."
  if ($name -eq '7z.exe') {
    & $Tool x -y "-o$DestDir" -- $Rar
  } else {
    $dest = $DestDir
    if ($dest[-1] -ne '\') { $dest = "$dest\" }
    & $Tool x -y $Rar $dest
  }
  if ($LASTEXITCODE -ne 0) {
    throw "解压失败（exit $LASTEXITCODE）"
  }
}

if (Test-Path -LiteralPath $ExePath) {
  Write-Step "已存在: $ExePath"
  exit 0
}

if (-not (Test-Path -LiteralPath $RarPath)) {
  throw "缺少 $RarPath"
}

if (-not (Test-Path -LiteralPath $ToolsDir)) {
  New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null
}

$rarMb = [math]::Round((Get-Item -LiteralPath $RarPath).Length / 1MB, 1)
Write-Step "找到压缩包 ($rarMb MB)，准备解压到 .tools\"

$tool = Find-RarTool
if (-not $tool) {
  $tool = Install-Portable7Zip
}

Invoke-Extract $tool $RarPath $ToolsDir

if (-not (Test-Path -LiteralPath $ExePath)) {
  throw '解压后未找到 cloudflared.exe'
}

$exeMb = [math]::Round((Get-Item -LiteralPath $ExePath).Length / 1MB, 1)
Write-Step "解压完成: cloudflared.exe ($exeMb MB)"
exit 0

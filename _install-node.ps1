# Download official Node.js LTS (Windows zip) into -TargetDir. No admin required.
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetDir
)

$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
} catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$nodeExe = Join-Path $TargetDir 'node.exe'
if (Test-Path -LiteralPath $nodeExe) {
  Write-Host "[lianji] 已存在: $nodeExe"
  exit 0
}

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

Write-Host '[lianji] 正在查询 Node.js LTS 版本...'
$index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 60
$lts = $index | Where-Object { $_.lts } | Select-Object -First 1
if (-not $lts) {
  throw '无法从 nodejs.org 解析 LTS 版本'
}
$ver = [string]$lts.version
$zipName = "node-$ver-win-$arch.zip"
$url = "https://nodejs.org/dist/$ver/$zipName"
Write-Host "[lianji] 下载 $url"

function Download-WithProgress([string]$DownloadUrl, [string]$OutFile) {
  $req = [System.Net.HttpWebRequest]::Create($DownloadUrl)
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

$tmpZip = Join-Path $env:TEMP "lianji-$zipName"
$extractRoot = Join-Path $env:TEMP ("lianji-node-extract-" + [guid]::NewGuid().ToString('N'))

try {
  Download-WithProgress $url $tmpZip
  Write-Host '[lianji] 下载完成'
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  Write-Host '[lianji] 正在解压...'
  Expand-Archive -LiteralPath $tmpZip -DestinationPath $extractRoot -Force

  $inner = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
  if (-not $inner -or -not (Test-Path -LiteralPath (Join-Path $inner.FullName 'node.exe'))) {
    throw '解压后未找到 node.exe'
  }

  $parent = Split-Path -Parent $TargetDir
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  if (Test-Path -LiteralPath $TargetDir) {
    Remove-Item -LiteralPath $TargetDir -Recurse -Force
  }
  Move-Item -LiteralPath $inner.FullName -Destination $TargetDir
  Write-Host "[lianji] Node.js $ver 已安装到 $TargetDir"
}
finally {
  Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw '安装失败：未找到 node.exe'
}
exit 0

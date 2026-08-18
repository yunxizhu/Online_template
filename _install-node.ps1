# Download official Node.js LTS (Windows zip) into -TargetDir. No admin required.
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetDir
)

$ErrorActionPreference = 'Stop'
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

$tmpZip = Join-Path $env:TEMP "lianji-$zipName"
$extractRoot = Join-Path $env:TEMP ("lianji-node-extract-" + [guid]::NewGuid().ToString('N'))

try {
  Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing -TimeoutSec 600
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

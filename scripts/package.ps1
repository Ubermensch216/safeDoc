#requires -version 5.1
<#
    safeDoc 배포 패키지 생성기

    빌드 결과(dist/index.html)와 실행기(deploy/)를 하나의 폴더로 모아 ZIP으로 묶는다.
    이 ZIP을 새 PC에 풀고 start.bat 을 실행하면 Node·npm 없이 바로 동작한다.

    사용:
        npm run package              빌드 후 패키징
        npm run package -- -SkipBuild   기존 dist 사용
#>
[CmdletBinding()]
param(
    [switch] $SkipBuild,
    [string] $OutDir = 'release'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root

function Write-Step($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "  [OK]   $text" -ForegroundColor Green }

$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$name    = "safeDoc-v$version"

# ---------- 1. 빌드 ----------
if (-not $SkipBuild) {
    Write-Step '빌드'
    # npm.ps1 은 실행 정책에 막힐 수 있으므로 npm.cmd 를 직접 호출한다.
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "빌드 실패 (exit $LASTEXITCODE)" }
}

$indexPath = Join-Path $root 'dist\index.html'
if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
    throw "dist\index.html 이 없습니다. -SkipBuild 없이 다시 실행하십시오."
}

# ---------- 2. 폴더 구성 ----------
Write-Step '패키지 구성'
$stage = Join-Path $root (Join-Path $OutDir $name)
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# index.html 은 start.bat 과 나란히 둔다(serve.ps1 의 첫 번째 탐색 경로).
Copy-Item -LiteralPath $indexPath -Destination (Join-Path $stage 'index.html')
foreach ($f in 'start.bat', 'serve.ps1', 'README.txt') {
    Copy-Item -LiteralPath (Join-Path $root "deploy\$f") -Destination (Join-Path $stage $f)
}

foreach ($f in Get-ChildItem -LiteralPath $stage) {
    Write-Ok ("{0,-12} {1,8:N1} KB" -f $f.Name, ($f.Length / 1KB))
}

# ---------- 3. 압축 ----------
Write-Step 'ZIP 생성'
$zip = Join-Path $root (Join-Path $OutDir "$name.zip")
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Ok ("{0}  ({1:N1} MB)" -f $zip, ((Get-Item -LiteralPath $zip).Length / 1MB))

Write-Host ''
Write-Host '  ────────────────────────────────────────────'
Write-Host '  새 PC에서: ZIP 압축 해제 → start.bat 실행'
Write-Host '  Node.js·npm·인터넷 연결이 필요 없습니다.'
Write-Host '  ────────────────────────────────────────────'
Write-Host ''

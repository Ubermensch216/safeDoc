#requires -version 5.1
<#
    safeDoc 로컬 실행 서버

    단일 HTML(index.html)을 http://localhost 로 서빙한다.
    Ollama가 file:// 출처(Origin: null)를 403으로 거부하므로, AI 탐지를 쓰려면
    반드시 http://localhost 로 열어야 한다.

    Windows 기본 구성요소(.NET HttpListener)만 사용하며 관리자 권한이 필요 없다.
#>
[CmdletBinding()]
param(
    [int]    $Port      = 8080,
    [string] $OllamaUrl = 'http://localhost:11434',
    [string] $Model     = 'gemma4:e2b',
    [switch] $NoBrowser
)

$ErrorActionPreference = 'Stop'

# 콘솔 출력 인코딩은 건드리지 않는다.
# 이 파일이 UTF-8 BOM으로 저장되어 있으므로 PowerShell이 문자열을 유니코드로 올바로 읽고,
# 출력할 때 콘솔 코드페이지(한국어 Windows는 CP949)로 자동 변환한다.
# 여기서 UTF-8을 강제하면 오히려 한글이 깨진다.

function Write-Head($text) { Write-Host ''; Write-Host $text -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "  [OK]   $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [주의] $text" -ForegroundColor Yellow }
function Write-Bad($text)  { Write-Host "  [오류] $text" -ForegroundColor Red }

Write-Host ''
Write-Host '  safeDoc - 개인정보 비식별화 프로그램' -ForegroundColor White
Write-Host '  ────────────────────────────────────────────'

# ---------- 1. index.html 위치 확인 ----------
# 배포 패키지(나란히) / 배포 패키지(dist 폴더) / 개발 저장소(deploy/에서 실행) 순으로 탐색
$parentDir = Split-Path $PSScriptRoot -Parent
$candidates = @(
    (Join-Path $PSScriptRoot 'index.html'),
    (Join-Path $PSScriptRoot 'dist\index.html'),
    (Join-Path $parentDir    'dist\index.html')
)

$indexPath = $null
foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c -PathType Leaf) { $indexPath = (Resolve-Path -LiteralPath $c).Path; break }
}

Write-Head '문서 확인'
if (-not $indexPath) {
    Write-Bad 'index.html 을 찾을 수 없습니다.'
    Write-Host ''
    Write-Host '    다음 위치 중 하나에 있어야 합니다:'
    foreach ($c in $candidates) { Write-Host "      - $c" }
    Write-Host ''
    Write-Host '    개발 저장소에서 실행하는 경우 먼저 빌드하십시오:  npm run build'
    Write-Host ''
    Read-Host '  Enter 키를 누르면 종료합니다'
    exit 1
}
$sizeKb = [math]::Round((Get-Item -LiteralPath $indexPath).Length / 1KB, 1)
Write-Ok "$indexPath ($sizeKb KB)"

# ---------- 2. Ollama 상태 확인 ----------
Write-Head 'AI 엔진 확인'
$aiReady = $false
try {
    $ver = Invoke-RestMethod -Uri "$OllamaUrl/api/version" -TimeoutSec 3 -ErrorAction Stop
    Write-Ok "Ollama $($ver.version) 연결됨 ($OllamaUrl)"

    $tags = Invoke-RestMethod -Uri "$OllamaUrl/api/tags" -TimeoutSec 5 -ErrorAction Stop
    $names = @($tags.models | ForEach-Object { $_.name })
    if ($names -contains $Model) {
        Write-Ok "모델 $Model 설치됨"
        $aiReady = $true
    }
    else {
        Write-Warn "모델 $Model 이(가) 없습니다. AI 탐지가 비활성화됩니다."
        Write-Host "         설치:  ollama pull $Model"
        if ($names.Count -gt 0) { Write-Host "         현재 설치된 모델: $($names -join ', ')" }
    }
}
catch {
    Write-Warn 'Ollama에 연결할 수 없습니다. 규칙 기반 탐지만 동작합니다.'
    Write-Host '         Ollama를 실행한 뒤 이 창을 닫고 다시 시작하십시오.'
}

# ---------- 3. 포트 확보 ----------
Write-Head '서버 시작'
$listener = $null
$boundPort = 0
for ($p = $Port; $p -lt ($Port + 10); $p++) {
    $try = New-Object System.Net.HttpListener
    $try.Prefixes.Add("http://localhost:$p/")
    try {
        $try.Start()
        $listener = $try
        $boundPort = $p
        break
    }
    catch {
        try { $try.Close() } catch { }
    }
}

if (-not $listener) {
    Write-Bad "포트 $Port ~ $($Port + 9) 가 모두 사용 중입니다."
    Write-Host '         다른 포트를 쓰려면:  powershell -File serve.ps1 -Port 9000'
    Write-Host ''
    Read-Host '  Enter 키를 누르면 종료합니다'
    exit 1
}

$url = "http://localhost:$boundPort/"
Write-Ok "$url 에서 서비스 중"
if ($aiReady) { Write-Ok "AI 탐지 사용 가능 ($Model)" }
else          { Write-Warn 'AI 탐지 비활성 - 규칙 기반으로만 동작합니다' }

Write-Host ''
Write-Host '  ────────────────────────────────────────────'
Write-Host '  브라우저에서 위 주소를 사용하십시오.'
Write-Host '  종료하려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으십시오.'
Write-Host '  ────────────────────────────────────────────'
Write-Host ''

if (-not $NoBrowser) {
    try { Start-Process $url | Out-Null } catch { Write-Warn '브라우저 자동 실행에 실패했습니다. 주소를 직접 입력하십시오.' }
}

# ---------- 4. 서빙 루프 ----------
# 단일 HTML이므로 모든 GET 경로에 같은 문서를 돌려준다.
# 파일이 변경되면 자동으로 다시 읽는다(개발 중 재빌드 대응).
$cachedBytes = $null
$cachedStamp = $null

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        try {
            if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') {
                $res.StatusCode = 405
                $res.Close()
                continue
            }

            # 브라우저 기본 요청은 문서를 통째로 돌려주지 않는다
            if ($req.Url.AbsolutePath -eq '/favicon.ico') {
                $res.StatusCode = 204
                $res.Close()
                continue
            }

            $item = Get-Item -LiteralPath $indexPath
            if ($null -eq $cachedBytes -or $item.LastWriteTimeUtc -ne $cachedStamp) {
                $cachedBytes = [System.IO.File]::ReadAllBytes($indexPath)
                $cachedStamp = $item.LastWriteTimeUtc
            }

            $res.StatusCode = 200
            $res.ContentType = 'text/html; charset=utf-8'
            # 개인정보를 다루므로 디스크 캐시를 남기지 않는다
            $res.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
            $res.Headers['Referrer-Policy'] = 'no-referrer'
            $res.Headers['X-Content-Type-Options'] = 'nosniff'
            $res.ContentLength64 = $cachedBytes.Length

            if ($req.HttpMethod -eq 'GET') {
                $res.OutputStream.Write($cachedBytes, 0, $cachedBytes.Length)
            }
            $res.Close()
        }
        catch {
            try { $res.StatusCode = 500; $res.Close() } catch { }
        }
    }
}
finally {
    Write-Host ''
    Write-Host '  서버를 종료했습니다.' -ForegroundColor Cyan
    try { $listener.Stop(); $listener.Close() } catch { }
}

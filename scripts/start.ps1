#requires -version 5.1
<#
    safeDoc 로컬 실행 스크립트 (start.bat 에서 호출)

    빌드된 단일 HTML(dist/index.html)을 http://localhost 로 서빙하고
    로컬 Ollama 서비스가 꺼져 있으면 자동으로 기동한 뒤 기본 브라우저를 연다.
    (Ollama는 file:// 출처 요청을 보안상 거부하므로 반드시 http://localhost 로 열어야 한다.)
#>
[CmdletBinding()]
param(
    [int]    $Port      = 8080,
    [string] $OllamaUrl = 'http://localhost:11434',
    [string] $Model     = 'gemma4:e2b',
    [switch] $NoBrowser
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

function Wait-ForKey {
    Write-Host ''
    Read-Host '계속하려면 Enter 키를 누르세요' | Out-Null
}

function Find-Ollama {
    foreach ($extraDir in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama'),
        (Join-Path $env:ProgramFiles 'Ollama')
    )) {
        if ($extraDir -and (Test-Path $extraDir) -and ($env:PATH -notlike "*$extraDir*")) {
            $env:PATH = "$extraDir;$env:PATH"
        }
    }
    $cmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
        (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
    )) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    return $null
}

function Test-OllamaEndpoint {
    param([string]$Endpoint)
    $probeUrl = ($Endpoint -replace 'localhost', '127.0.0.1').TrimEnd('/') + '/api/tags'
    try {
        $res = Invoke-WebRequest -UseBasicParsing -Uri $probeUrl -TimeoutSec 2 -ErrorAction Stop
        if ($res.StatusCode -eq 200) { return $true }
    } catch {}
    return $false
}

try {
    Write-Host '============================================================================'
    Write-Host '  safeDoc - 개인정보 비식별화 프로그램 시작 (start.bat)'
    Write-Host '============================================================================'
    Write-Host ''

    # --------------------------------------------------------------------------
    # 1. 빌드 산출물(dist/index.html) 확인
    # --------------------------------------------------------------------------
    $indexPath = Join-Path $ProjectRoot 'dist\index.html'
    if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
        Write-Host '[ERROR] 빌드된 프로그램(dist\index.html)이 없습니다.'
        Write-Host '        먼저 프로젝트 루트의 setup.bat 을 실행해 초기 설치를 완료해 주세요.'
        Wait-ForKey
        exit 1
    }
    $sizeMb = [math]::Round((Get-Item -LiteralPath $indexPath).Length / 1MB, 2)
    Write-Host "[OK] 프로그램 파일 확인: dist\index.html ($sizeMb MB)"

    # --------------------------------------------------------------------------
    # 2. 로컬 AI 엔진(Ollama) 확인 및 필요 시 자동 기동
    # --------------------------------------------------------------------------
    $aiReady = $false
    $ollamaConnected = Test-OllamaEndpoint -Endpoint $OllamaUrl
    if (-not $ollamaConnected) {
        $ollamaExe = Find-Ollama
        if ($ollamaExe) {
            Write-Host '[INFO] Ollama 서비스가 꺼져 있어 백그라운드에서 시작합니다...'
            $ollamaApp = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
            if (Test-Path $ollamaApp) {
                Start-Process -FilePath $ollamaApp | Out-Null
            } else {
                Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
            }
            for ($i = 1; $i -le 15; $i++) {
                if (Test-OllamaEndpoint -Endpoint $OllamaUrl) {
                    $ollamaConnected = $true
                    break
                }
                Start-Sleep -Seconds 2
            }
            if (-not $ollamaConnected) {
                Write-Host '[WARN] Ollama 응답 확인이 지연되고 있습니다. 규칙 기반 탐지로 먼저 시작합니다.'
            }
        } else {
            Write-Host '[WARN] Ollama가 설치되어 있지 않습니다. 규칙 기반 탐지만 동작합니다.'
            Write-Host '       AI 문맥 탐지를 사용하려면 setup.bat 을 실행해 주세요.'
        }
    }

    if ($ollamaConnected) {
        $baseApi = ($OllamaUrl -replace 'localhost', '127.0.0.1').TrimEnd('/')
        try {
            $tags = Invoke-RestMethod -Uri "$baseApi/api/tags" -TimeoutSec 5 -ErrorAction Stop
            $names = @($tags.models | ForEach-Object { $_.name })
            if (($names -contains $Model) -or ($names -contains "$Model`:latest")) {
                Write-Host "[OK] 로컬 AI 엔진 연결 및 모델 준비 완료: $Model ($OllamaUrl)"
                $aiReady = $true
            } else {
                Write-Host "[WARN] Ollama는 연결되었으나 모델($Model)이 없습니다. 규칙 기반 탐지만 동작합니다."
                Write-Host '       모델 설치를 위해 setup.bat 을 실행해 주세요.'
            }
        } catch {
            Write-Host '[WARN] Ollama 모델 목록 확인에 실패했습니다. 규칙 기반 탐지로 계속 시작합니다.'
        }
    }

    # --------------------------------------------------------------------------
    # 3. 로컬 HTTP 서버 포트 확보 (8080~8089 자동 탐색)
    # --------------------------------------------------------------------------
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
        } catch {
            try { $try.Close() } catch {}
        }
    }

    if (-not $listener) {
        Write-Host "[ERROR] 포트 $Port ~ $($Port + 9) 가 모두 사용 중입니다."
        Write-Host '        다른 포트를 지정하려면: start.bat -Port 9000'
        Wait-ForKey
        exit 1
    }

    $url = "http://localhost:$boundPort/"
    Write-Host ''
    Write-Host "[INFO] safeDoc 서버를 시작합니다: $url"
    if ($aiReady) {
        Write-Host "[INFO] 탐지 모드: 규칙 기반 + 로컬 AI ($Model)"
    } else {
        Write-Host '[INFO] 탐지 모드: 규칙 기반 전용 (AI 비활성)'
    }
    if (-not $NoBrowser) {
        Write-Host '[INFO] 기본 웹 브라우저를 자동으로 엽니다.'
        try {
            Start-Process $url | Out-Null
        } catch {
            Write-Host "[WARN] 브라우저 자동 실행에 실패했습니다. 브라우저에서 $url 을 직접 열어주세요."
        }
    }
    Write-Host '[INFO] 종료하려면 이 창에서 Ctrl+C를 누르거나 창을 닫으세요.'
    Write-Host ''

    # --------------------------------------------------------------------------
    # 4. 단일 HTML 정적 서빙 루프 (변경 시 자동 재로드, 디스크 캐시 차단)
    # --------------------------------------------------------------------------
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
                $res.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
                $res.Headers['Referrer-Policy'] = 'no-referrer'
                $res.Headers['X-Content-Type-Options'] = 'nosniff'
                $res.ContentLength64 = $cachedBytes.Length

                if ($req.HttpMethod -eq 'GET') {
                    $res.OutputStream.Write($cachedBytes, 0, $cachedBytes.Length)
                }
                $res.Close()
            } catch {
                try { $res.StatusCode = 500; $res.Close() } catch {}
            }
        }
    } finally {
        Write-Host ''
        Write-Host '[INFO] safeDoc 서버를 종료했습니다.'
        try { $listener.Stop(); $listener.Close() } catch {}
    }
    exit 0
} catch {
    Write-Host ''
    Write-Host "[ERROR] 서버 실행 중 오류가 발생했습니다: $($_.Exception.Message)"
    Wait-ForKey
    exit 1
}

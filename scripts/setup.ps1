#requires -version 5.1
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

$DefaultModel = 'gemma4:e2b'
$NonInteractive = $false
$SkipAi = $false

if ($ExtraArgs) {
    foreach ($arg in $ExtraArgs) {
        if ($arg -ieq '--yes' -or $arg -ieq '-y') {
            $NonInteractive = $true
        } elseif ($arg -ieq '--skip-ai' -or $arg -ieq '--no-ai' -or $arg -ieq '-SkipAi') {
            $SkipAi = $true
        }
    }
}

function Wait-IfInteractive {
    if (-not $NonInteractive) {
        Write-Host ''
        Read-Host '계속하려면 Enter 키를 누르세요' | Out-Null
    }
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($machinePath) { $parts += $machinePath }
    if ($userPath) { $parts += $userPath }
    if ($parts.Count -gt 0) {
        $env:PATH = ($parts -join ';')
    }
    foreach ($extraDir in @(
        'C:\Program Files\nodejs',
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama'),
        (Join-Path $env:ProgramFiles 'Ollama')
    )) {
        if ($extraDir -and (Test-Path $extraDir) -and ($env:PATH -notlike "*$extraDir*")) {
            $env:PATH = "$extraDir;$env:PATH"
        }
    }
}

function Test-Node18 {
    Refresh-ProcessPath
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $cmd) {
        return $false
    }
    try {
        $verText = (& $cmd.Source -p "parseInt(process.versions.node.split('.')[0], 10)" 2>$null | Out-String).Trim()
        $major = 0
        if ([int]::TryParse($verText, [ref]$major) -and $major -ge 18) {
            return $true
        }
    } catch {}
    return $false
}

function Find-Ollama {
    Refresh-ProcessPath
    $cmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
        (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
    )) {
        if ($candidate -and (Test-Path $candidate)) {
            $dir = Split-Path -Parent $candidate
            if ($env:PATH -notlike "*$dir*") {
                $env:PATH = "$dir;$env:PATH"
            }
            return $candidate
        }
    }
    return $null
}

function Test-OllamaRunning {
    try {
        $res = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 -ErrorAction Stop
        if ($res.StatusCode -eq 200) { return $true }
    } catch {}
    $ollamaExe = Find-Ollama
    if ($ollamaExe) {
        try {
            & $ollamaExe list *> $null
            if ($LASTEXITCODE -eq 0) { return $true }
        } catch {}
    }
    return $false
}

function Ensure-OllamaRunning {
    if (Test-OllamaRunning) {
        Write-Host '  [OK] Ollama 서버가 이미 실행 중입니다.'
        return $true
    }
    Write-Host '  [INFO] Ollama 백그라운드 서비스를 시작하는 중...'
    $ollamaApp = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
    if (Test-Path $ollamaApp) {
        Start-Process -FilePath $ollamaApp | Out-Null
    } else {
        $ollamaExe = Find-Ollama
        if (-not $ollamaExe) { return $false }
        Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
    }
    for ($i = 1; $i -le 20; $i++) {
        if (Test-OllamaRunning) {
            Write-Host '  [OK] Ollama 서버가 준비되었습니다.'
            return $true
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Install-NodeOfficial {
    Write-Host '  [INFO] 공식 사이트(nodejs.org)에서 Node.js 22 LTS 설치 파일을 다운로드합니다...'
    $prevProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing -TimeoutSec 30
        $rel = $releases | Where-Object { $_.version -match '^v22\.' } | Select-Object -First 1
        if (-not $rel) {
            throw 'Node.js v22 릴리스 정보를 찾을 수 없습니다.'
        }
        $ver = $rel.version
        if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
            $arch = 'arm64'
        } elseif ([Environment]::Is64BitOperatingSystem) {
            $arch = 'x64'
        } else {
            $arch = 'x86'
        }
        $url = "https://nodejs.org/dist/$ver/node-$ver-$arch.msi"
        $msi = Join-Path $env:TEMP "node-$ver-$arch.msi"
        Write-Host "  [INFO] 다운로드 중: $url"
        Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing -TimeoutSec 300
        Write-Host '  [INFO] Node.js 설치 프로그램을 실행합니다... (관리자 권한 확인 창이 뜨면 허용해 주세요)'
        $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$msi`"", '/passive', '/norestart') -Wait -PassThru
        if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
            throw "Node.js MSI 설치가 실패했습니다 (종료 코드: $($proc.ExitCode))."
        }
    } finally {
        $ProgressPreference = $prevProgress
    }
}

function Install-OllamaOfficial {
    Write-Host '  [INFO] Ollama 공식 설치 프로그램을 다운로드합니다...'
    $prevProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        $exe = Join-Path $env:TEMP 'OllamaSetup.exe'
        Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $exe -UseBasicParsing -TimeoutSec 600
        Write-Host '  [INFO] Ollama를 설치하는 중입니다...'
        # NOTE: Start-Process -Wait는 설치 완료 후 백그라운드로 실행되는 ollama app.exe 때문에 무한 대기할 수 있어
        #       설치 프로세스 자체($proc.HasExited)만 대기합니다.
        $proc = Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT', '/NORESTART') -PassThru
        $deadline = (Get-Date).AddMinutes(10)
        while (-not $proc.HasExited) {
            if ((Get-Date) -gt $deadline) {
                if (Find-Ollama) { break }
                throw 'Ollama 설치 프로그램 대기 시간이 초과되었습니다.'
            }
            Start-Sleep -Milliseconds 500
        }
        if ($proc.HasExited -and $proc.ExitCode -ne 0) {
            throw "Ollama 설치 프로그램이 실패했습니다 (종료 코드: $($proc.ExitCode))."
        }
    } finally {
        $ProgressPreference = $prevProgress
    }
}

try {
    Write-Host '============================================================================'
    Write-Host '  safeDoc - 개인정보 비식별화 프로그램 자동 설치 및 초기 세팅 (setup.bat)'
    Write-Host '============================================================================'
    Write-Host ''
    Write-Host '  이 스크립트는 다음 항목을 자동으로 확인하고 준비합니다:'
    Write-Host '    1. Node.js (v18 이상) 확인 및 자동 설치'
    Write-Host '    2. 프로젝트 필수 패키지 설치 (npm)'
    Write-Host '    3. 프로그램 단일 HTML 빌드 (dist/index.html)'
    if ($SkipAi) {
        Write-Host '    4. 로컬 AI 엔진(Ollama) 설치 및 모델 다운로드 (--skip-ai 옵션으로 건너뜀)'
    } else {
        Write-Host '    4. 로컬 AI 엔진(Ollama) 설치 확인 및 자동 설치'
        Write-Host "    5. Ollama 서비스 실행 및 AI 모델 다운로드 ($DefaultModel)"
    }
    Write-Host ''

    $wingetFailed = $false

    # --------------------------------------------------------------------------
    # [1/5] Node.js 18+ 확인 및 설치
    # --------------------------------------------------------------------------
    Write-Host '[1/5] Node.js (v18 이상) 확인 중...'
    if (-not (Test-Node18)) {
        Write-Host '  [INFO] Node.js 18 이상이 필요합니다. 자동 설치를 진행합니다...'
        $wingetCmd = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($wingetCmd) {
            Write-Host '  [INFO] winget으로 Node.js LTS 설치를 시도합니다...'
            & $wingetCmd.Source install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0) {
                $wingetFailed = $true
                Write-Host "  [WARN] winget 설치에 실패했습니다 (종료 코드: $LASTEXITCODE). 공식 설치 파일로 자동 전환합니다..."
            }
        }
        if (-not (Test-Node18)) {
            Install-NodeOfficial
        }
        if (-not (Test-Node18)) {
            Write-Host ''
            Write-Host '  [ERROR] Node.js 18 이상 설치 확인에 실패했습니다.'
            Write-Host '          https://nodejs.org 에서 Node.js LTS를 직접 설치한 뒤'
            Write-Host '          새 터미널 창에서 setup.bat 을 다시 실행해 주세요.'
            Wait-IfInteractive
            exit 1
        }
    }
    $nodeVer = (& node.exe -v 2>$null | Out-String).Trim()
    Write-Host "  [OK] Node.js $nodeVer 확인 완료"
    Write-Host ''

    # --------------------------------------------------------------------------
    # [2/5] npm 의존성 패키지 설치
    # --------------------------------------------------------------------------
    Write-Host '[2/5] 프로젝트 필수 패키지(npm) 설치 확인 중...'
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCmd) {
        throw 'npm.cmd 를 찾을 수 없습니다. Node.js 설치 상태를 확인해 주세요.'
    }
    if (Test-Path 'node_modules') {
        & $npmCmd.Source install
    } elseif (Test-Path 'package-lock.json') {
        & $npmCmd.Source ci
    } else {
        & $npmCmd.Source install
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  [ERROR] npm 패키지 설치 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.'
        Wait-IfInteractive
        exit 1
    }
    Write-Host '  [OK] npm 패키지 설치 완료'
    Write-Host ''

    # --------------------------------------------------------------------------
    # [3/5] 프로그램 프로덕션 빌드 (dist/index.html)
    # --------------------------------------------------------------------------
    Write-Host '[3/5] 프로그램 빌드 중 (npm run build)...'
    & $npmCmd.Source run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  [ERROR] 프로그램 빌드에 실패했습니다.'
        Wait-IfInteractive
        exit 1
    }
    $builtIndex = Join-Path $ProjectRoot 'dist\index.html'
    if (-not (Test-Path -LiteralPath $builtIndex -PathType Leaf)) {
        Write-Host '  [ERROR] 빌드 산출물(dist\index.html)을 찾을 수 없습니다.'
        Wait-IfInteractive
        exit 1
    }
    $sizeMb = [math]::Round((Get-Item -LiteralPath $builtIndex).Length / 1MB, 2)
    Write-Host "  [OK] dist\index.html 빌드 완료 ($sizeMb MB)"
    Write-Host ''

    if ($SkipAi) {
        Write-Host '[4/5] Ollama 설치를 건너뛰었습니다 (--skip-ai).'
        Write-Host '[5/5] AI 모델 다운로드를 건너뛰었습니다 (--skip-ai).'
        Write-Host ''
        Write-Host '============================================================================'
        Write-Host '  기본 설치가 완료되었습니다 (규칙 기반 탐지 모드).'
        Write-Host '  이제 start.bat 을 실행하면 safeDoc이 자동으로 시작됩니다.'
        Write-Host '  추후 AI 탐지를 추가하려면 setup.bat 을 옵션 없이 다시 실행해 주세요.'
        Write-Host '============================================================================'
        Wait-IfInteractive
        exit 0
    }

    # --------------------------------------------------------------------------
    # [4/5] Ollama 설치 확인 및 자동 설치
    # --------------------------------------------------------------------------
    Write-Host '[4/5] 로컬 AI 엔진(Ollama) 확인 중...'
    $ollamaExe = Find-Ollama
    if (-not $ollamaExe) {
        Write-Host '  [INFO] Ollama가 설치되어 있지 않습니다. 자동 설치를 진행합니다...'
        $wingetCmd = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($wingetCmd -and (-not $wingetFailed)) {
            Write-Host '  [INFO] winget으로 Ollama 설치를 시도합니다...'
            & $wingetCmd.Source install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  [WARN] winget 설치에 실패했습니다 (종료 코드: $LASTEXITCODE). 공식 설치 파일로 자동 전환합니다..."
            }
            $ollamaExe = Find-Ollama
        }
        if (-not $ollamaExe) {
            Install-OllamaOfficial
            $ollamaExe = Find-Ollama
        }
        if (-not $ollamaExe) {
            Write-Host ''
            Write-Host '  [ERROR] Ollama 자동 설치를 완료하지 못했습니다.'
            Write-Host '          https://ollama.com/download 에서 직접 설치 후 setup.bat 을 다시 실행해 주세요.'
            Write-Host '          (AI 없이 규칙 기반 탐지만 사용하려면 지금 바로 start.bat 을 실행할 수 있습니다.)'
            Wait-IfInteractive
            exit 1
        }
    }
    $ollamaVer = (& $ollamaExe --version 2>$null | Out-String).Trim()
    if (-not $ollamaVer) { $ollamaVer = 'Ollama' }
    Write-Host "  [OK] $ollamaVer 확인 완료"
    Write-Host ''

    # --------------------------------------------------------------------------
    # [5/5] Ollama 서버 기동 및 필수 모델 다운로드 (gemma4:e2b)
    # --------------------------------------------------------------------------
    Write-Host '[5/5] Ollama 서비스 상태 확인 및 AI 모델 설치 중...'
    if (-not (Ensure-OllamaRunning)) {
        Write-Host '  [ERROR] Ollama 서버를 시작하지 못했습니다. Ollama 앱을 실행한 뒤 다시 시도해 주세요.'
        Write-Host '          (AI 없이 규칙 기반 탐지만 사용하려면 지금 바로 start.bat 을 실행할 수 있습니다.)'
        Wait-IfInteractive
        exit 1
    }

    Write-Host "  [INFO] 문맥 탐지용 로컬 AI 모델($DefaultModel)을 확인/다운로드합니다... (최초 1회 약 4.6GB)"
    & $ollamaExe pull $DefaultModel
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ERROR] $DefaultModel 모델 다운로드에 실패했습니다. 인터넷 연결을 확인해 주세요."
        Write-Host '          (AI 없이 규칙 기반 탐지만 사용하려면 지금 바로 start.bat 을 실행할 수 있습니다.)'
        Wait-IfInteractive
        exit 1
    }
    Write-Host "  [OK] $DefaultModel 준비 완료"
    Write-Host ''

    Write-Host '============================================================================'
    Write-Host '  모든 환경 세팅이 완료되었습니다.'
    Write-Host '  이제 start.bat 을 실행하면 safeDoc 서버와 웹 화면이 자동으로 시작됩니다.'
    Write-Host '============================================================================'
    Wait-IfInteractive
    exit 0
} catch {
    Write-Host ''
    Write-Host "  [ERROR] 설치 중 예기치 않은 오류가 발생했습니다: $($_.Exception.Message)"
    Wait-IfInteractive
    exit 1
}

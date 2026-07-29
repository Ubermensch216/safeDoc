#requires -version 5.1
<#
    개발용 정적 파일 서버

    Node가 없는 환경에서 브라우저 검증 하네스(test/browser/harness.html)를 띄우기 위한
    임시 도구다. Node를 설치한 뒤에는 `npm run dev`(Vite)를 쓰면 된다.

    ES 모듈은 file:// 에서 CORS로 차단되므로 http로 서빙해야 한다.
#>
param(
    [int]    $Port = 8081,
    [string] $Root = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.ico'  = 'image/x-icon'
}

$rootFull = (Resolve-Path -LiteralPath $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host ""
Write-Host "  개발 서버: http://localhost:$Port/" -ForegroundColor Cyan
Write-Host "  루트     : $rootFull"
Write-Host "  하네스   : http://localhost:$Port/test/browser/harness.html"
Write-Host "  Ctrl+C 로 종료" -ForegroundColor DarkGray
Write-Host ""

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $res = $ctx.Response
        try {
            $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
            if ($rel -eq '') { $rel = 'index.html' }
            $path = Join-Path $rootFull ($rel -replace '/', '\')

            # 루트 밖으로 나가는 경로 차단
            $resolved = $null
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $resolved = (Resolve-Path -LiteralPath $path).Path
            }

            if (-not $resolved -or -not $resolved.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
                $res.StatusCode = 404
                $res.Close()
                continue
            }

            $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
            $bytes = [System.IO.File]::ReadAllBytes($resolved)
            $res.StatusCode = 200
            if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] }
            else { $res.ContentType = 'application/octet-stream' }
            $res.Headers['Cache-Control'] = 'no-store'
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            $res.Close()
        }
        catch {
            try { $res.StatusCode = 500; $res.Close() } catch { }
        }
    }
}
finally {
    try { $listener.Stop(); $listener.Close() } catch { }
    Write-Host "  개발 서버를 종료했습니다." -ForegroundColor Cyan
}

[CmdletBinding()]
param(
    [string]$EmsdkRoot
)

# Builds wasm/client_core.c into web/client-core.js and web/client-core.wasm.
# Any Emscripten works; by default this uses the SDK in $env:EMSDK, else Samsung's
# Emscripten fork (1.39.4.7, fastcomp) at %USERPROFILE%\samsung-emscripten.

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($EmsdkRoot)) {
    $EmsdkRoot = if ($env:EMSDK) { $env:EMSDK } else {
        Join-Path $env:USERPROFILE 'samsung-emscripten\emscripten-release-bundle\emsdk'
    }
}
$EmsdkRoot = [System.IO.Path]::GetFullPath($EmsdkRoot)

$emscripten = @('upstream\emscripten', 'fastcomp\emscripten') |
    ForEach-Object { Join-Path $EmsdkRoot $_ } |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ 'emcc.bat') -PathType Leaf } |
    Select-Object -First 1
if (-not $emscripten) {
    throw "No Emscripten SDK was found at $EmsdkRoot. Pass -EmsdkRoot or set EMSDK to its emsdk directory."
}

$config = Join-Path $EmsdkRoot '.emscripten'
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
    throw "The Emscripten SDK at $EmsdkRoot is not activated. Run 'emsdk activate latest --embedded' there."
}

$python = Get-ChildItem -LiteralPath (Join-Path $EmsdkRoot 'python') -Filter python.exe -Recurse -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
$node = Get-ChildItem -LiteralPath (Join-Path $EmsdkRoot 'node') -Filter node.exe -Recurse -File -ErrorAction SilentlyContinue |
    Select-Object -First 1

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $root 'wasm\client_core.c'
$output = Join-Path $root 'web\client-core.js'

$savedEnvironment = @{ PATH = $env:PATH; EMSDK = $env:EMSDK; EM_CONFIG = $env:EM_CONFIG; EM_CACHE = $env:EM_CACHE }
try {
    $env:EMSDK = $EmsdkRoot
    $env:EM_CONFIG = $config
    $env:EM_CACHE = Join-Path $EmsdkRoot '.emscripten_cache'
    $paths = @($emscripten)
    if ($python) { $paths += $python.DirectoryName }
    if ($node) { $paths += $node.DirectoryName }
    $env:PATH = (($paths + $env:PATH) -join ';')

    # The module owns no heap allocations: one static buffer and a small stack are enough.
    $arguments = @(
        $source, '-O3', '-std=c11', '-Wall', '-Wextra', '-Werror',
        '-s', 'WASM=1',
        '-s', 'ENVIRONMENT=web,node',
        '-s', 'TOTAL_STACK=65536',
        '-s', 'TOTAL_MEMORY=262144',
        '-s', 'ALLOW_MEMORY_GROWTH=0',
        '-s', 'MODULARIZE=1',
        '-s', 'EXPORT_NAME=createClientCore',
        '-s', "EXPORTED_FUNCTIONS=['_core_buffer','_core_buffer_size','_core_auth_proof','_core_gamepad_attach','_core_gamepad_detach','_core_gamepad_encode','_core_gamepad_commit','_core_gamepad_invalidate']",
        '-o', $output
    )
    & (Join-Path $emscripten 'emcc.bat') @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "The client core failed to build with exit code $LASTEXITCODE."
    }
} finally {
    foreach ($name in $savedEnvironment.Keys) {
        if ($null -eq $savedEnvironment[$name]) {
            Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
        } else {
            Set-Item -Path "Env:$name" -Value $savedEnvironment[$name]
        }
    }
}

Write-Host "Built $output"

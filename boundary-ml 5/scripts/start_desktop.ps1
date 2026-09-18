param(
    [switch]$Mock
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path $python)) {
    throw 'Missing .venv. Install Python 3.12 and run the setup commands in README.md first.'
}

Push-Location $projectRoot
try {
    & $python scripts\doctor.py
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $env:CAREKOALA_PYTHON = $python
    $env:CAREKOALA_MOCK = if ($Mock) { '1' } else { '0' }

    Push-Location (Join-Path $projectRoot 'electron-app')
    try {
        if ($Mock) { & npm start -- --mock } else { & npm start }
        exit $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}

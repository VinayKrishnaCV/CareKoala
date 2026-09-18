$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$archive=Join-Path ([System.IO.Path]::GetTempPath()) ('carekoala-llama-'+[guid]::NewGuid().ToString()+'.zip')
try {
    Invoke-WebRequest 'https://github.com/ggml-org/llama.cpp/releases/download/b11036/llama-b11036-bin-win-cpu-x64.zip' -OutFile $archive
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne '12a8446782a39bccdfc2be71543b6903af9780e5f6b46abfc8745855bca83928'){throw 'Runtime checksum mismatch'}
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $projectRoot 'runtime\llama-b11036') -Force
} finally { if(Test-Path -LiteralPath $archive){Remove-Item -LiteralPath $archive} }

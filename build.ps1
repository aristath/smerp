$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force bin | Out-Null
go build -trimpath -ldflags '-s -w' -o bin/smerp.exe .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node "$scriptDir\bin\precomcli.js" @args
exit $LASTEXITCODE

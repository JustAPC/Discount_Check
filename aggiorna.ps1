# Aggiorna Discount Check all'ultima release, in place.
#
# In place è il punto: l'ID di un'estensione non pacchettizzata dipende dal percorso
# della cartella. Stessa cartella = stesso ID = credenziali, catalogo e pin nella barra
# intatti. Spostarla o reinstallarla altrove equivale a partire da zero.
#
# Si lancia con doppio clic su aggiorna.bat, che chiama questo file.
$ErrorActionPreference = 'Stop'

$repo = 'JustAPC/Discount_Check'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dc-" + [guid]::NewGuid().ToString('N'))

function Fine($msg) {
  Write-Host ''
  Write-Host $msg
  Read-Host 'Premi Invio per chiudere'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  exit
}

Write-Host 'Discount Check - aggiornamento'
Write-Host "Cartella: $dir"

$manifest = Join-Path $dir 'manifest.json'
if (-not (Test-Path $manifest)) {
  Fine @"
ERRORE: qui dentro non c'è manifest.json.
Questo script va tenuto nella cartella dell'estensione, quella che hai
selezionato con 'Carica estensione non pacchettizzata'.
"@
}

$local = (Get-Content $manifest -Raw | ConvertFrom-Json).version
Write-Host "Versione installata: $local"
Write-Host ''
Write-Host "Cerco l'ultima release..."

try {
  $api = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'discount-check' }
} catch {
  Fine 'ERRORE: non riesco a contattare GitHub. Controlla la connessione e riprova.'
}

$latest = $api.tag_name -replace '^v', ''
$url = ($api.assets | Where-Object { $_.name -eq 'discount-check.zip' } | Select-Object -First 1).browser_download_url
if (-not $latest -or -not $url) { Fine 'ERRORE: la release non contiene discount-check.zip.' }

Write-Host "Ultima disponibile: $latest"
if ($latest -eq $local) { Fine "Sei già aggiornato. Non c'è niente da fare." }

New-Item -ItemType Directory -Path $tmp -Force | Out-Null
Write-Host ''
Write-Host "Scarico $latest..."
$zip = Join-Path $tmp 'new.zip'
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

# Backup prima di toccare qualsiasi cosa: se lo zip è rotto si torna indietro.
Write-Host 'Backup della cartella attuale...'
$backup = Join-Path $tmp 'backup'
Copy-Item $dir $backup -Recurse

Write-Host 'Installo...'
Expand-Archive -Path $zip -DestinationPath $dir -Force

$now = (Get-Content $manifest -Raw | ConvertFrom-Json).version
if ($now -ne $latest) {
  Write-Host "ERRORE: dopo l'aggiornamento la version è $now invece di $latest. Ripristino."
  Get-ChildItem $dir -Force | Remove-Item -Recurse -Force
  Copy-Item (Join-Path $backup '*') $dir -Recurse -Force
  Fine 'Ripristinata la versione precedente.'
}

Write-Host ''
Write-Host "Fatto: ora è la $now."
Write-Host ''
Write-Host 'Perché Chrome la carichi davvero va riavviato.'
Write-Host 'L''estensione NON viene rimossa: credenziali, catalogo e pin restano.'
$ans = Read-Host 'Riavvio Chrome adesso? [S/n]'

if ($ans -match '^[nN]') {
  Fine @"
Ok. Quando vuoi: chiudi e riapri Chrome, oppure vai su chrome://extensions
e premi Aggiorna sulla scheda di Discount Check.
"@
}

Write-Host 'Riavvio Chrome...'
$exe = (Get-Process chrome -ErrorAction SilentlyContinue | Select-Object -First 1).Path
if (-not $exe) {
  $exe = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
# CloseMainWindow e non Kill: Chrome salva la sessione e la riapre se è impostato
# su "Continua da dove avevi interrotto".
Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }
Start-Sleep -Seconds 3
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

if ($exe) { Start-Process $exe; Fine 'Riaperto.' }
Fine 'Chrome chiuso, ma non ho trovato chrome.exe: riaprilo a mano.'

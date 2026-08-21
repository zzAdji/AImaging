# AImaging - Démarrage unique des 3 services (Phase 2, Étape 14)
#
# 1. Backend FastAPI  (port 8000)   - `uvicorn main:app`
# 2. opencxr (optionnel, port 8011) - microservice Python 3.12 + TensorFlow
# 3. Client Vite     (port 5173)
#
# Chaque service s'ouvre dans sa propre fenêtre PowerShell ; les journaux sont
# conservés dans `logs\`. Le script attend les health checks et affiche l'état
# final sans masquer les erreurs.
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File .\start_dev.ps1
# Option :   .\start_dev.ps1 -NoOpenCxr   (démarre sans le microservice)

param(
  [switch]$NoOpenCxr
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK : $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    AVERTISSEMENT : $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    ERREUR : $msg" -ForegroundColor Red }

Write-Step "Prérequis"

# 1. Python pour le backend
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
  Write-Err "python introuvable dans le PATH. Installez Python 3.14 et réessayez."
  exit 1
}
Write-Ok "python -> $($py.Source)"

# 2. venv312 pour opencxr (TensorFlow)
$venv312Py = Join-Path $Root ".venv312\Scripts\python.exe"
if (-not $NoOpenCxr -and -not (Test-Path $venv312Py)) {
  Write-Warn ".venv312 introuvable - le microservice opencxr ne pourra pas démarrer."
  Write-Warn "Créez-le avec : python -m venv .venv312 puis installez requirements de scripts/opencxr."
}

# 3. Dépendances frontend
if (-not (Test-Path (Join-Path $Root "client\node_modules"))) {
  Write-Warn "client\node_modules absent - lancez : cd client; npm install"
}

# ---------------------------------------------------------------------------
Write-Step "Démarrage du backend FastAPI (port 8000)"

$backendLog = Join-Path $LogDir "backend.log"
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd '$Root\server'; uvicorn main:app --port 8000 2>&1 | Tee-Object -FilePath '$backendLog'"
) -WorkingDirectory (Join-Path $Root "server") | Out-Null

Write-Step "Attente de GET /health (port 8000)..."
$healthOk = $false
$started = Get-Date
while ((Get-Date) -lt $started.AddSeconds(120)) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2
    $healthOk = $true
    Write-Ok ("/health -> " + ($health | ConvertTo-Json -Compress))
    if ($health.radiography_models_loaded) {
      Write-Ok "Ensemble radiographique chargé ($($health.radiography_models_loaded) modèles)."
    } else {
      Write-Warn "radiography_models_loaded est absent/false - vérifiez models/chest_xray/*.pt"
    }
    if ($health.gemini_ready) { Write-Ok "Gemini prêt (GEMINI_API_KEY définie)." }
    else { Write-Warn "Gemini non configuré : /radiography/report renverra 503 (mode dégradé usuel)." }
    if ($health.opencxr_ready) { Write-Ok "opencxr prêt." }
    if ($health.startup_errors -and $health.startup_errors.Count -gt 0) {
      Write-Warn ("startup_errors : " + ($health.startup_errors -join "; "))
    }
    break
  } catch {
    Start-Sleep -Milliseconds 1500
  }
}
if (-not $healthOk) {
  Write-Err "Le backend n'a pas répondu sur :8000 après 120 s. Consultez logs\backend.log."
  exit 1
}

# ---------------------------------------------------------------------------
if (-not $NoOpenCxr) {
  Write-Step "Démarrage du microservice opencxr (port 8011)"
  if (Test-Path $venv312Py) {
    $microLog = Join-Path $LogDir "opencxr.log"
    Start-Process powershell -ArgumentList @(
      "-NoExit",
      "-Command",
      "cd '$Root\scripts\opencxr'; ..\..\.venv312\Scripts\python.exe -m uvicorn microserver:app --host 127.0.0.1 --port 8011 2>&1 | Tee-Object -FilePath '$microLog'"
    ) -WorkingDirectory (Join-Path $Root "scripts\opencxr") | Out-Null

    Write-Step "Attente de GET /health (port 8011)..."
    $cxOk = $false
    $started = Get-Date
    while ((Get-Date) -lt $started.AddSeconds(90)) {
      try {
        $cxHealth = Invoke-RestMethod -Uri "http://127.0.0.1:8011/health" -TimeoutSec 2
        $cxOk = $true
        Write-Ok ("opencxr /health -> " + ($cxHealth | ConvertTo-Json -Compress))
        break
      } catch {
        Start-Sleep -Milliseconds 1500
      }
    }
    if (-not $cxOk) {
      Write-Warn "opencxr n'a pas répondu sur :8011. Le backend principal fonctionne néanmoins en mode dégradé."
    }
  } else {
    Write-Warn "venv312 absent : opencxr non lancé. Le serveur principal reste utilisable (opencxr_ready=false)."
  }
} else {
  Write-Warn "openCxr désactivé par -NoOpenCxr."
}

# ---------------------------------------------------------------------------
Write-Step "Démarrage du client Vite (port 5173)"
$clientLog = Join-Path $LogDir "client.log"
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd '$Root\client'; npm run dev 2>&1 | Tee-Object -FilePath '$clientLog'"
) -WorkingDirectory (Join-Path $Root "client") | Out-Null

Write-Step "Attente du client (port 5173)..."
$clientOk = $false
$started = Get-Date
while ((Get-Date) -lt $started.AddSeconds(60)) {
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:5173" -TimeoutSec 2 -UseBasicParsing
    if ($resp.StatusCode -eq 200) { $clientOk = $true; Write-Ok "Client Vite accessible (HTTP 200)."; break }
  } catch {
    Start-Sleep -Milliseconds 1200
  }
}
if (-not $clientOk) {
  Write-Err "Le client n'a pas répondu sur :5173. Consultez logs\client.log."
  exit 1
}

Write-Step "Récapitulatif"
Write-Host ""
Write-Host "  Backend  : http://127.0.0.1:8000   (/health, /radiography/predict, /dicom/parse, /workspace/...)" -ForegroundColor White
if (-not $NoOpenCxr) { Write-Host "  opencxr  : http://127.0.0.1:8011   (/health, /sort, /standardize)" -ForegroundColor White }
Write-Host "  Client   : http://127.0.0.1:5173" -ForegroundColor White
Write-Host ""
Write-Host "  Journaux : $LogDir" -ForegroundColor DarkGray
Write-Host ""
Write-Warn "Note : Gemini hors palier gratuit ne doit pas recevoir de données patient réelles."

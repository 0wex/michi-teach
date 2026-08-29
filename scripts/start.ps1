$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20+ no está instalado o no está disponible en PATH.'
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'pnpm no está instalado. Ejecuta: corepack enable'
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Rust/Cargo no está instalado. Instálalo desde https://rustup.rs/'
}

pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm start

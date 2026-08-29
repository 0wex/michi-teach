# Lumi Desktop

Asistente educativo pop-out para escritorio, construido con Tauri 2, Vite y Convex.

## Requisitos

- Node.js 20 o superior.
- pnpm 11 (`corepack enable`).
- Rust estable mediante [rustup](https://rustup.rs/).
- Dependencias de Tauri para tu sistema operativo.
  - Windows: Visual Studio Build Tools con **Desarrollo para el escritorio con C++** y WebView2.
  - macOS: Xcode Command Line Tools.
  - Linux: WebKitGTK y las dependencias indicadas por Tauri.

## Instalación e inicio

```bash
git clone <URL_DEL_REPOSITORIO>
cd Lumi
corepack enable
pnpm install --frozen-lockfile
pnpm start
```

En Windows también puedes ejecutar el lanzador con validación de requisitos:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

## Convex

Para crear o conectar el backend:

```bash
pnpm convex:dev
```

Convex creará el deployment y `VITE_CONVEX_URL` en `.env.local`. Ese archivo es local y no debe subirse a GitHub.

Para desplegar las funciones en producción:

```bash
pnpm convex:deploy
```

## Compilación

```bash
pnpm desktop:build
```

Los instaladores se generan en `src-tauri/target/release/bundle/`.

## Comandos

| Comando | Uso |
| --- | --- |
| `pnpm start` | Inicia Lumi como app desktop en desarrollo |
| `pnpm desktop:build` | Genera el ejecutable y los instaladores |
| `pnpm convex:dev` | Inicia y sincroniza el backend Convex |
| `pnpm convex:deploy` | Despliega el backend Convex |

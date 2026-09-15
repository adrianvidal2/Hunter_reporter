# reporter

App web **local** para gestionar reportes de bug bounty sobre una carpeta de
ficheros ya existente. El sistema de ficheros es la verdad; todo lo demás es
vista o índice reconstruible.

## Arranque

```bash
pnpm install
pnpm dev        # http://127.0.0.1:3100 (solo localhost)
```

Requiere Node 22 + pnpm. La configuración vive en `.env.local`:

| Variable | Significado |
|---|---|
| `REPORTS_ROOT` | Carpeta raíz con los proyectos (`demo_project/REPORTES_YWH/*.pdf` + `demo_project/reportes/*.md`) |
| `API_TOKEN` | Token `Bearer` de la API de ingesta (se genera con `openssl rand -hex 32`) |

Si `REPORTS_ROOT` falta o no es válida, la app **no arranca** (falla al inicio
con mensaje claro).

## Estructura requerida

El repo vive en `reporter-app/`; los **datos** (`reportes/`, hermano del repo)
jamás se versionan (posible NDA). `.settings/` y `.env.local` (tokens y claves)
tampoco: están en el `.gitignore`.

```
proxectos/reporter/
├── reporter.sh                  # arranque/gestión (fuera del repo)
├── README.md                    # este + mapa de estructura (fuera del repo)
│
├── reportes/                    ← REPORTS_ROOT (.env.local): JAMÁS en el repo
│   ├── _inbox/                  # reportes sin proyecto (API de ingesta)
│   ├── .config/                 # plantillas y prompts globales
│   ├── .trash/ .history/        # papelera y copias previas a guardado
│   └── <proyecto>/              # un directorio por programa (slug)
│       ├── .config/platform.json    # plataforma (yeswehack|intigriti)
│       ├── programa.json            # detalle del programa (GET plataforma)
│       ├── pentest/
│       │   ├── programa.md          # informe del programa (generado, editable)
│   │   │   ├── recon/<tool>/<fecha>/  # salidas de recon + run.json
│   │   │   └── launches.json        # histórico de lanzamientos de agentes
│       ├── REPORTES_YWH/            # PDFs entregados (solo lectura en la app)
│       └── reportes/                # borradores markdown (lo que editas)
│
└── reporter-app/                ← el repo git: SOLO código
    ├── src/
    │   ├── app/                 # rutas Next (páginas + server actions + API)
    │   │   ├── api/             # ingesta (v1), ficheros (raw), eventos (SSE)
    │   │   ├── programas/       # explorador multiplataforma (YWH | Intigriti)
    │   │   ├── escaneos/        # agentes + acciones del módulo recon
    │   │   ├── cvss/            # calculadora CVSS 3.1
    │   │   └── ajustes/         # LLM, tokens, rutas de binarios
    │   ├── components/          # UI (editor, exploradores, panels)
    │   ├── core/                # dominio puro, sin Next → aquí van los tests
    │   │   ├── fs/              # paths seguros, tree, atomic, watcher, uploads
    │   │   ├── reports/         # front-matter, plantillas
    │   │   ├── llm/ ywh/ intigriti/ programs/ recon/ cvss/ orca/ prompts/ db/
    │   ├── server/              # estado vivo de servidor (watcher, recon
    │   │                        #   runner, orca, escaneos)
    │   └── lib/                 # env, autosave, secrets (AES-256-GCM)
    ├── docs/                    # contratos de API verificados + fixtures
    ├── scripts/                 # migraciones (p. ej. platform.json)
    ├── .env.local               # NUNCA en el repo
    └── .settings/               # NUNCA en el repo (tokens/claves cifrados)
```

Reglas: `reportes/` no se versiona (la app lo recrea si falta); el índice
SQLite es reconstruible (`pnpm run db:reset`); los tests usan directorios
temporales y jamás tocan `reportes/` real.

## Qué hay

- **Explorador**: proyectos con contadores, PDFs entregados (visor propio con
  paginación/zoom) y borradores markdown (editor CodeMirror + preview
  sanitizada, autoguardado, historial `.history/`, papelera `.trash/`)
- **API de ingesta** (`/api/v1/*`): tus scripts depositan reportes por HTTP

## Recibir un reporte por API (copiable)

```bash
API_TOKEN=$(grep '^API_TOKEN=' .env.local | cut -d= -f2)

curl -s -X POST http://127.0.0.1:3100/api/v1/reports \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"content":"# XSS reflejado en /buscar","filename":"xss-buscar","project":"demo_project"}'
# → {"path":"demo_project/reportes/xss-buscar.md"}
```

Referencia completa de la API (campos, respuestas, códigos, ejemplos extra):
**[docs/api-ingesta.md](docs/api-ingesta.md)**

## Desarrollo

```bash
pnpm test        # suite completa (unit + integración, fixtures en tmpdir)
pnpm build       # build de producción + type-check
pnpm db:reset    # recrea el índice SQLite (reconstruible por diseño)
```

Estructura esencial: `src/core/` (núcleo puro, sin Next — ahí van los tests),
`src/app/` (rutas y Server Actions), `src/db/` (índice Drizzle), `src/lib/`
(utilidades). El plan de construcción detallado vive en `../PLAN.md`.

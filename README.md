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

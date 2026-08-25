# API de ingesta — referencia

Endpoint local para que tus scripts depositen reportes en la carpeta gestionada
por la app (`REPORTS_ROOT` de `.env.local`).

- Base: `http://127.0.0.1:3100/api/v1`
- Autenticación: **todas** las rutas exigen `Authorization: Bearer <API_TOKEN>`
  (el valor vive en `reporter-app/.env.local`, clave `API_TOKEN`)
- El servidor escucha **solo en 127.0.0.1**: nada expuesto a la red local

---

## `POST /api/v1/reports` — depositar un reporte

Body JSON:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `content` | string | sí | Contenido markdown del reporte (no vacío). Máx. 2 MB de body |
| `filename` | string | no | Nombre **simple**: sin `/`, `\` ni `..` (si los trae → 400). Se normaliza (NFC) y siempre acaba en `.md` |
| `project` | string | no | Proyecto **existente** (si no → 404). Sin él, el reporte cae en `_inbox/` |
| `overwrite` | boolean | no | `false` → si ya existe el nombre, 409. Por defecto se añade sufijo ` (2)`, ` (3)`… |

Respuestas:

- `201` → `{ "path": "…" }` ruta relativa al fichero creado (p. ej. `demo_project/reportes/informe.md` o `_inbox/report-20260819-190000-a1b2c3.md`)
- `400` body/filename inválido · `401` token malo o ausente · `404` proyecto inexistente · `409` colisión con `overwrite:false` · `413` body > 2 MB

### Ejemplo copiable

```bash
# Mínimo: cae en _inbox/ con nombre autogenerado
curl -s -X POST http://127.0.0.1:3100/api/v1/reports \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"content":"# XSS reflejado en /buscar\n\n## PoC\n\n```\n<b>prueba</b>\n```"}'
```

```bash
# Con proyecto y nombre (crear y clavar la variable en una línea):
API_TOKEN=$(grep '^API_TOKEN=' reporter-app/.env.local | cut -d= -f2)
curl -s -X POST http://127.0.0.1:3100/api/v1/reports \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"content":"# IDOR en /api/v1/users","filename":"idor-users","project":"demo_project"}'
```

```bash
# Desde un fichero local (contenido del reporte ya escrito):
curl -s -X POST http://127.0.0.1:3100/api/v1/reports \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d "$(jq -n --rawfile c informe.md '{content: $c, filename: "informe", project: "demo_project"}')"
```

## `GET /api/v1/projects` — proyectos existentes

```bash
curl -s http://127.0.0.1:3100/api/v1/projects -H "Authorization: Bearer $API_TOKEN"
# → {"projects":["demo_project"]}
```

## `GET /api/v1/reports?project=<nombre>` — ficheros de un proyecto

```bash
curl -s 'http://127.0.0.1:3100/api/v1/reports?project=demo_project' \
  -H "Authorization: Bearer $API_TOKEN"
```

Respuesta (`FileEntry` por fichero, orden natural por nombre):

```json
{
  "project": "demo_project",
  "delivered": [{ "name": "informe.pdf", "relPath": "demo_project/REPORTES_YWH/informe.pdf", "size": 215064, "mtimeMs": 1755621234000 }],
  "drafts":   [{ "name": "borrador.md", "relPath": "demo_project/reportes/borrador.md", "size": 1024, "mtimeMs": 1755621234000 }]
}
```

---

**Notas de seguridad:** comparación del token en tiempo constante; sin
`API_TOKEN` configurado la API queda cerrada (500); los nombres de fichero se
sanitizan y todas las rutas se validan contra `REPORTS_ROOT` (path traversal →
400, batería de tests en `src/core/fs/traversal.test.ts`).

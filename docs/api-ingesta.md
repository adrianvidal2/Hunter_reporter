# Ingestion API — reference

Local endpoint so your scripts can drop reports into the folder managed by
the app (`REPORTS_ROOT` from `.env.local`).

- Base: `http://127.0.0.1:3100/api/v1`
- Authentication: **all** routes require `Authorization: Bearer <API_TOKEN>`
  (the value lives in `reporter-app/.env.local`, key `API_TOKEN`)
- The server listens **on 127.0.0.1 only**: nothing exposed to the local network

---

## `POST /api/v1/reports` — drop a report

JSON body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `content` | string | yes | Markdown content of the report (non-empty). Max 2 MB body |
| `filename` | string | no | **Plain** name: no `/`, `\` or `..` (→ 400 if present). NFC-normalized, always ends in `.md` |
| `project` | string | no | **Existing** project (→ 404 otherwise). Without it, the report lands in `_inbox/` |
| `overwrite` | boolean | no | `false` → if the name already exists, 409. By default a ` (2)`, ` (3)`… suffix is appended |

Responses:

- `201` → `{ "path": "…" }` relative path of the created file (e.g. `demo_project/reportes/report.md` or `_inbox/report-20260819-190000-a1b2c3.md`)
- `400` invalid body/filename · `401` bad or missing token · `404` unknown project · `409` collision with `overwrite:false` · `413` body > 2 MB

### Copy-paste examples

```bash
# Minimal: lands in _inbox/ with an auto-generated name
curl -s -X POST http://127.0.0.1:3100/api/v1/reports \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"content":"# Reflected XSS in /search\n\n## PoC\n\n```\n<b>test</b>\n```"}'
```

```bash
# With project and name (create and pin the variable in one line):
API_TOKEN=$(grep '^API_TOKEN=' reporter-app/.env.local | cut -d= -f2)
curl -s -X POST http://127.0.0.1:3100/api/v1/reports \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"content":"# IDOR in /api/v1/users","filename":"idor-users","project":"demo_project"}'
```

```bash
# From a local file (report content already written):
curl -s -X POST http://127.0.0.1:3100/api/v1/reports \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $API_TOKEN" \
  -d "$(jq -n --rawfile c report.md '{content: $c, filename: "report", project: "demo_project"}')"
```

## `GET /api/v1/projects` — existing projects

```bash
curl -s http://127.0.0.1:3100/api/v1/projects -H "Authorization: Bearer $API_TOKEN"
# → {"projects":["demo_project"]}
```

## `GET /api/v1/reports?project=<name>` — files of a project

```bash
curl -s 'http://127.0.0.1:3100/api/v1/reports?project=demo_project' \
  -H "Authorization: Bearer $API_TOKEN"
```

Response (`FileEntry` per file, natural order by name):

```json
{
  "project": "demo_project",
  "delivered": [{ "name": "report.pdf", "relPath": "demo_project/REPORTES_YWH/report.pdf", "size": 215064, "mtimeMs": 1755621234000 }],
  "drafts":   [{ "name": "draft.md", "relPath": "demo_project/reportes/draft.md", "size": 1024, "mtimeMs": 1755621234000 }]
}
```

---

**Security notes:** constant-time token comparison; without a configured
`API_TOKEN` the API stays closed (500); filenames are sanitized and all paths
are validated against `REPORTS_ROOT` (path traversal → 400, test battery in
`src/core/fs/traversal.test.ts`).

# Intigriti Researcher API — contratos (verificado en vivo 2026-08-29)

> Investigación para la segunda plataforma. Espec OpenAPI guardado como
> fixture permanente: `docs/fixtures/intigriti/intigriti-swagger-v1.0.json`
> (OpenAPI 3.0, versión 1.0, 6 rutas — API «Researcher»).
>
> Fixtures anonimizados: `programs-page1.json` (item de lista) y
> `program-detail.json` (detalle completo con domains + ROE).

---

## ⛔ NO HAY SUBMISSIONS EN ESTA API (respuesta definitiva — no reinvestigar)

**La API de researcher de Intigriti NO expone tus submissions ni su estado.**
El spec completo (6 rutas) solo cubre: programas (lista/detalle), domains,
rules-of-engagements, activities (feed de programas) y payouts (BETA). No hay
equivalente a `GET /user/reports` de YesWeHack, ni endpoint privado fuera de
este spec para researchers. Cualquier «seguimiento de submissions» tendría
que hacerse fuera de la API oficial (web scraping), que NO es plan. Cerrado.

---

## Base URL y auth (verificado en vivo ✅ 2026-08-29)

- Base: `https://api.intigriti.com/external/researcher`
- Auth: **`Authorization: Bearer <TOKEN>`** — verificado con token real:
  `GET /v1/programs?limit=3&offset=0` → **HTTP 200**. El spec lo declara
  como `bearerAuth` (HTTP Bearer); el token es un **PAT de larga duración**
  (66 chars, no un JWT de sesión corto como el de YWH): se crea en la web
  (perfil → API → researcher) y no caduca cada horas.
- Sin auth / token inválido: **401** `{"code":"UNAUTH001","title":"Access
  denied.","status":401,"identifier":"<uuid>","extraParameters":{}}` (mismo
  cuerpo para cualquier esquema erróneo; el gateway no revela cuál espera).
- **No hay endpoints públicos**: sin token, `/v1/programs` es 401. La
  degradación a «solo públicos» de YWH aquí NO existe.

## Endpoints (los 6 del spec)

| Método | Ruta | Qué da |
|---|---|---|
| GET | `/v1/programs` | Lista de programas (resumen, paginada) ✅ vivo |
| GET | `/v1/programs/{programId}` | **Detalle** del programa ✅ vivo |
| GET | `/v1/programs/{programId}/domains/{versionId}` | Scope por versión |
| GET | `/v1/programs/{programId}/rules-of-engagements/{versionId}` | Reglas por versión |
| GET | `/v1/programs/activities` | Feed de actividad de programas |
| GET | `/v1/payouts` | Pagos (BETA) |

## ⛔ Submissions: NO expuestas (definitivo)

La API de researcher **no expone mis submissions ni su estado** — no existe
endpoint para ello en el spec (6 rutas arriba) y no hay API privada oficial
alternativa. Equivalente de «mis reportes» de YWH: **no es posible**. Solo
hay `payouts` (BETA) y `activities` (feed de programas, no de submissions).

## Paginación (verificado en vivo ✅)

Por **offset**, no por página: `limit` (0..500) + `offset`.

- `GET /v1/programs?limit=3&offset=0` → `{ "maxCount": 221, "records": [...] }`
- `offset=1&limit=1` → salta el primer record (verificado).
- `offset=9999` → **HTTP 200 con `records: []`** (graceful, igual que YWH).
- Iterar: `offset += limit` hasta reunir `maxCount` records.

## Item de LISTA (verificado en vivo, ver fixture anonimizado)

```jsonc
{
  "id": "uuid (programId para el detalle)",
  "handle": "innovapost-anon",
  "name": "…",
  "following": false,
  "minBounty": { "value": 50, "currency": "EUR" },
  "maxBounty": { "value": 3000, "currency": "EUR" },
  "confidentialityLevel": { "id": 4, "value": "Public" },
  "status": { "id": 3, "value": "Open" },
  "type": { "id": 1, "value": "Bug Bounty" },
  "webLinks": { "detail": "https://app.intigriti.com/…" },
  "industry": "…"
}
```

## Detalle (verificado en vivo ✅, ver fixture anonimizado)

Campos: los del overview + `domains` y `rulesOfEngagement` como VERSIONES
incrustadas (con endpoints por versión además):

- `domains: { id, createdAt, content: Domain[] }` — **6 entradas** en el
  programa probado. Cada dominio: `{ id, type{id,value} (Wildcard/Url/…),
  endpoint, tier{id,value} (Critical/High/…/"No Bounty"), description,
  requiredSkills[] }`. **El scope IN es esta lista** (no hay in/out
  estructurados como en YWH; el out-of-scope vive en las reglas).
- `rulesOfEngagement: { id, attachments[], createdAt, content }`:
  - `content.description` — reglas completas (markdown).
  - `content.testingRequirements`: **`userAgent`** (User-Agent requerido,
    puede venir `""`), **`requestHeader`** (p. ej. `X-Intigriti-Username:
    {Username}` — header obligatorio alternativo), `intigritiMe` (bool),
    `automatedTooling` (int, política de tooling).
  - `content.safeHarbour` — protección legal (bool).

## Equivalencias con la pestaña Programa (YWH → Intigriti)

| Concepto | YWH | Intigriti |
|---|---|---|
| Lista | `/programs?page=N` `{items,pagination}` | `/v1/programs?limit&offset` `{maxCount,records}` |
| Detalle | `/programs/{slug}` 74 campos | `/v1/programs/{programId}` (con domains+ROE versionados) |
| Scope IN | `scopes[]` | `domains.content[]` (endpoint, tier, type, description) |
| Scope OUT | `out_of_scope[]` | no estructurado (en rules/description) |
| Reglas | `rules`/`rules_html` | `rulesOfEngagement.content.description` |
| **User-Agent** | `user_agent` | `testingRequirements.userAgent` (+ `requestHeader`) |
| Reward grid | `reward_grid_*` por severidad | ❌ no hay grid: solo `minBounty`/`maxBounty` + `tier` del dominio |
| Severidad | `cvss`/`criticity` | ❌ no expuesta en el detalle (se asigna en submission) |
| Mis reportes | `/user/reports` ✅ | **⛔ no existe** (ver arriba) |
| Auth | JWT sesión corto (Bearer) | PAT larga duración (Bearer) |

## Fixtures

- `intigriti-swagger-v1.0.json` — spec OpenAPI completo (público).
- `programs-page1.json` — item de lista anonimizado (bug bounty con bounty +
  responsible disclosure sin bounty; types/status/confidentiality reales).
- `program-detail.json` — detalle anonimizado con 3 dominios (wildcard
  critical, url high, wildcard no-bounty), ROE completo con userAgent
  requerido, requestHeader y safeHarbour.

---

## Vista bueno de la arquitectura para dos plataformas (anotado aquí)

Aprobado el orden 1-4 con tres CONDICIONES obligatorias:

1. **Paso 1 = refactor puro** (adaptador YWH → modelo neutro): cero
   comportamiento nuevo, los tests siguen en verde, la pantalla de YWH se
   comporta exactamente igual. Cualquier cambio visual es un bug.
2. **Modelo neutro NO lossy**: el `raw` de la plataforma se conserva SIEMPRE
   en el modelo (raw junto al neutro) y la pestaña Programa debe poder
   mostrar lo específico de cada plataforma aunque el modelo neutro no lo
   tenga. Prohibido perder campos al pasar por el adaptador.
3. **Paginación Intigriti**: por offset, limit hasta 500; paginar hasta
   agotar `maxCount`, con el mismo pacing que YWH y un TOPE DE SEGURIDAD de
   iteraciones por si `maxCount` es inconsistente (no entrar en bucle).

Además, anotado arriba como definitivo: **la API no expone submissions**.

Orden acordado: 1) adaptador YWH → neutro (refactor puro) · 2) módulo
Intigriti (cliente+parsers+render propio) · 3) tokens (uno por plataforma) +
Ajustes · 4) `/intigriti` maestro + crear proyecto con `platform.json`.
# YesWeHack API — contratos verificados (bloque 9)

> Fuente primaria: repo `yeswehack/yeswecaido` (clonado y leído en el
> checkpoint 9.0) **+ verificación empírica con sesión real el 2026-08-21**
> (paso 9.1). Fixtures anonimizados en `docs/fixtures/ywh/`.

## Autenticación

**PAT no disponible**: la cuenta usada no ofrece personal access tokens.
Método definitivo (checkpoint 9.0 ajustado): **JWT de sesión pegado a mano**,
exactamente como hace yeswecaido (localStorage → `access_token`).

- Esquema **verificado empíricamente**: `Authorization: Bearer <JWT>` sobre
  `https://api.yeswehack.com` → HTTP 200. Es el mismo esquema del plugin.
- **Vida corta**: el JWT observado llevaba `exp` a ~1 h de vista. La vía
  principal de actualización es la UI de Ajustes (9.3).
- **Detección de expiración**: antes de cada llamada se decodifica el claim
  `exp` del payload (base64url, local, sin petición) y se compara con el
  reloj; caducado → error propio sin gastar la llamada. Ante un 401 en
  respuestas, mismo tratamiento (token inválido/caducado).
- Claims observados: `iat, exp, roles, email, totp_enabled`.
- **Precedencia de fuentes del token (9.3)**: UI → `.settings/ywh.json`
  (cifrado AES-256-GCM, infra del 8.1) **>** arranque → `YWH_JWT` en
  `.env.local` (solo si el fichero cifrado no existe). Documentado aquí como
  contrato.

## Degradación a públicos (verificado)

Sin cabecera (o token inválido): HTTP 200 con **solo programas públicos**
(observado: 63 resultados vs 82 con JWT válido → 19 privados visibles solo
con token). La app degrada y avisa; no rompe.

## `GET /programs?page=N` — lista paginada ✅ verificado

- `page` **empieza en 1**; iterar hasta `pagination.nb_pages` (paginación en
  el body, no en cabeceras). Observado: `results_per_page: 42`.
- Respuesta (ver fixture `programs-page1.json`):

```jsonc
{
  "items": [ /* ver abajo */ ],
  "pagination": { "page": 1, "nb_pages": 2, "results_per_page": 42, "nb_results": 82 }
}
```

- **Item real observado** (35+ campos; los parsers de yeswecaido cubren un
  subconjunto gracias a `.catch()`):
  `title, slug, country, activity_area, average_first_response_time, type
  ("bug-bounty"|"vdp-in-app"), status, demo, public, bounty, gift,
  hall_of_fame, hacktivity, report_collaboration_active, pid, secured,
  disabled, vdp, archived, reports_count, bounty_reward_min,
  bounty_reward_max, scopes_count, pentest_campaign_status, thumbnail, event,
  business_unit{…}, hunter_audience, scopes_enabled, last_update_at,
  report_submission_cost`
- **Drift cazado en vivo (9.4)**: `pid` llega como **string** en la API real
  (los parsers lo tipan `string|number`). Los fixtures se corrigieron para
  reflejarlo: si un fixture contradice la API, manda la API.

## `GET /programs/{slug}` — detalle ✅ verificado

- **74 campos observados** (ver fixture `program-detail.json`). Superset del
  `programParser` de yeswecaido con adiciones reales: `vpn_outbound_ips,
  vpn_ips, vpn_active, sla_enabled, sla_grid, credit_balance, rights,
  attachments, systemic_issue_rule_*, leakage_rule_*, ywh_triager_user_agent…`
- `scopes[]` real (más rico que el parser del plugin):
  `{ scope, scope_type, scope_type_name, asset_value, report_count }`
  (`report_count` puede ser `null`)
- `business_unit` real: `{ name, slug, description, currency,
  already_activate_product, logo{…} }`
- `reward_grid_*` con `{ bounty_low, bounty_medium, bounty_high,
  bounty_critical }`; `stats` con `max_reward/average_reward` **nullable**
  (observado `null` en un programa público).

## `GET /programs/{slug}` — detalle verificado EN VIVO (2026-08-25)

Probado contra el programa real `example-program` (privado,
`public: false`, `bounty: true`, `type: bug-bounty`, `status: V`) con JWT de
sesión fresca → **HTTP 200, 15,5 KB, 74 campos** (coincide con
`ProgramBugBountyDetail` del spec, ver fixture `program-detail.json`).

### Scope in/out

- `scopes[]` (IN) — un solo asset observado:
  `{ scope, scope_type: "web-application", scope_type_name: "Web application",
    asset_value: "HIGH", report_count: null }`
  → el campo `asset_value` (nivel/valor del asset) y `report_count` (nullable).
- `out_of_scope: string[]` — texto libre; muestra real:
  `["All domains or subdomains not listed in the above list of 'Scopes'."]`

### User-agent obligatorio y VPN

- `user_agent: string` — **UA requerido**; en este programa viene definido:
  `BugBounty-YWH-ExampleBrand` (formato `BugBounty-YWH-<Marca>`). El spec
  lo tipa `string` (puede ser `null` en otros programas).
- `ywh_triager_user_agent: null` (campo triager, nullable).
- `vpn_active: false`, `vpn_ips: null`, `restricted_ips: null`,
  `vpn_outbound_ips` no presente (no es exigencia VPN aquí).

### Reglas y acceso

- `rules` / `rules_html` (Markdown/HTML): descripción + reglas; `rules_html`
  lleva el render. Texto de marca eliminado en el fixture.
- `account_access: "You can self-register."` (política de acceso).
- `supported_languages: ["GB"]`.

### Tipos de vulnerabilidad aceptados/rechazados

- `qualifying_vulnerability: string[]` — **aceptados** (12 aquí): SQLi, XSS,
  RCE, IDOR, privilege escalation, auth bypass, business logic con impacto
  real, file access (LFI/RFI/XXE/SSRF/XSPA), CORS con impacto, CSRF con
  impacto, Open Redirect, secrets expuestos en scope.
- `non_qualifying_vulnerability: string[]` — **rechazados** (40 aquí):
  clickjacking, DoS, CVEs <30 días, self-XSS, missing headers, SPF/DKIM/DMARC,
  session mgmt, disclosures sin PoC, blind SSRF sin PoC, rate-limit/pas$, user
  enumeration, GraphQL introspection, cupones/promos, etc.

### Recompensa y otros

- `bounty_reward_min: 50`, `bounty_reward_max: 1000`; `reward_grid_high`
  real `{50,300,700,1000}`; `reward_grid_*_null` arrays nullable.
- `stats: { max_reward:null, average_reward:null, average_first_time_response:1,
  total_reports, total_reports_last* , total_reports_current_month }`.
- `account_access`, `sla_grid:null`, `report_submission_cost`, flags
  `hunter_message_enabled`, `report_collaboration_active`, etc.

> **NOTA de datos privados**: la respuesta expone el programa privado (slug,
> BU “Example Brand”, thumbnails `YR_*`, UA de marca, scope real). El fixture
> `program-detail.json` neutraliza todos esos valores (solo se conservan los
> enums y la estructura). Los tipos de vuln y las reglas son genéricos y sin
> identificador → se mantienen literalmente.

## Errores observados

- `401` (token basura): body `{"code":401,"message":"Invalid JWT Token"}`
- `404`: slug inexistente (tratado como `NotFound` en yeswecaido)
- Timeout / rate limit: **no observados** en las pruebas (no apareció
  cabecera `retry-after`); el cliente los tipará igualmente por si acaso.

## Fixtures (contrato para los tipos Zod de 9.2)

- `docs/fixtures/ywh/programs-page1.json` — 3 items anonimizados:
  bug-bounty público · bug-bounty **privado** · vdp-in-app público.
- `docs/fixtures/ywh/program-detail.json` — **detalle completo (74 campos)
  generado del programa real `example-program` (25/8) y
  anonimizado**: scope `example-anonymized.com`, BU neutral (“Business Unit
  1”), UA `BugBounty-YWH-AnonymizedBrand`, thumbnail/banner/logos
  neutralizados. Se conservan enums, estructura y los tipos de vuln
  aceptados/rechazados (genéricos, sin identificador). **Sin slugs reales,
  sin business units reales, sin dominios/.mx, sin texto de marca.**
- `docs/fixtures/ywh/openapi-v25.7.0.json` — **spec OpenAPI PÚBLICO** de
  `api.yeswehack.com` (ver abajo); documento público de YWH, sin datos de
  usuario, útil como contrato para cualquier paso futuro.

---

## Reportes propios del hunter — investigación (2026-08-25)

> Objetivo: saber si se puede ver el estado de MIS reportes desde la API.

### Hallazgo 1: la API publica su OpenAPI completo (sin auth)

- `GET https://api.yeswehack.com/doc` — UI ReDoc
- `GET https://api.yeswehack.com/doc.json` — spec OpenAPI 3.0, **v25.7.0**,
  377 rutas, 1,7 MB. Copiado a `docs/fixtures/ywh/openapi-v25.7.0.json`.
- **Esquema de seguridad declarado**: `PersonalAccessToken` = **apiKey en
  cabecera `X-AUTH-TOKEN`** (NO `Authorization: Bearer`). MATIZ: el 21/8 el
  JWT de sesión funcionó con `Bearer` en `/programs` — la gateway aceptaba
  ambos esquemas entonces; con el token del 25/8 NINGUNO funcionó (ver
  bloqueo). Para pasos futuros: probar `X-AUTH-TOKEN` primero.

### Hallazgo 2: mapa de existencia de rutas (sondeo en vivo)

401 (existe, protegida) vs 404 (no existe) — semántica validada con
controles (`/reports` da 404 con y sin token; `/programs` sin token da 200
porque es pública; firma corrompida → 401):

| Endpoint | Estado | Notas |
|---|---|---|
| `GET /user/reports` | **EXISTE** (401) | NO documentada en el OpenAPI — endpoint interno del frontend/móvil |
| `GET /reports/me` | **EXISTE** (401) | Ídem, no documentada |
| `GET /reports` | 404 | La lista general NO está expuesta |
| `GET /hacktivity`, `/me`, `/users/me`, `/findings`, `/bugs`, `/user/findings`, `/user/programs`, `/user/balance`, `/user/payments`, `/hunter/reports`, `/my/reports`, `/profile` | 404 | No existen |
| `GET /reports/{id}` | **documentada** | "Get report detail" · respuesta `ReportDetail` (ver abajo) |

### Hallazgo 3: forma del reporte (`ReportDetail`, 83 campos del OpenAPI)

Lo que preguntaba la investigación, TODO está en `GET /reports/{id}`:

| Dimensión | Campos de `ReportDetail` |
|---|---|
| **Estado** | `status.workflow_state` · `tracking_status` · `patch_status` · `triage_status` · `marked_as` · `seems_invalid` · `triaged` |
| **Programa** | `program` (ProgramReport: `title, slug, public, bounty, bounty_reward_min, type, vdp…`) · `business_unit` |
| **Fecha** | `created_at` · `accepted_at` · `resolved_at` · `expected_remediation_date` · `finding_detected_at` |
| **Severidad** | `cvss` (`score, vector, criticity N/L/M/H/C, version`) · `bug_type` (categoría CWE) · `criticity` · `max_suggested_severity` |
| **Recompensa** | `reward` · `hunter_bounty_value` · `bonus` · `cvss_bonus` · `currency` · `bounty_allowed` |
| Extra útil | `title, scope, host, local_id, hunter, collaborators, attachments, tags, cve[], cwe[], rights[], user_roles[]` |

La forma de la LISTA (`/user/reports`) no está en el OpenAPI (ruta interna);
`ReportEmbed` documentado es mínimo (`id, local_id, title`). **VERIFICADO EN
VIVO 2026-08-25** — ver siguiente sección.

## `GET /user/reports` — MIS reportes (lista) ✅ verificado en vivo

**`/user/reports` es el endpoint correcto** para listar los reportes del
hunter autenticado. No está documentado en el OpenAPI (endpoint interno del
frontend/móvil), pero responde 200 con: `{ items[], pagination }`.

- **Paginación** (idéntica estructura a `/programs`): `page` empieza en 1,
  `results_per_page: 50`, `nb_pages`, `nb_results`. `?page=N` fuera de rango
  → 200 con `items: []` (no 404). Fixture: `user-reports-item.json`.
- **`/reports/me` NO es válido**: con JWT válido responde **404** (el 401 de
  ayer era un artefacto del gateway que protege routes antes de resolver).
  Ignorar.

```jsonc
{
  "items": [ /* item, abajo */ ],
  "pagination": { "page": 1, "nb_pages": 1, "results_per_page": 50, "nb_results": 19 }
}
```

**Item real (16 claves)** — ver fixture `docs/fixtures/ywh/user-reports-item.json`
(anonimizado; enums reales, programa/hunter/urls neutralizadas):

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `local_id` | int / string | `local_id` estilo `YWH-000000` |
| `title`, `scope` | string | este item ya viene con `title` (más rico que el `ReportEmbed` documentado) |
| `program` | object | Programa privado incluido: `title, slug, type ("bug-bounty"), status ("V"), public, bunk… bounty:true` |
| `status.workflow_state` | string | **estado** p. ej. `"under_review"` |
| `cvss` | object | `{ criticity: "C", vector: "CVSS:3.1/…", score: 10, version: "v3.1" }` |
| `hunter` | object | `{ username }` (solo username) |
| `reward`, `cost_credits`, `currency` | int / null / string | recompensa + moneda (`EUR`) |
| `marked_as` | string | `"R"` (¿reported?) |
| `collaborative` | bool | |
| `created_at`, `changed_at` | string | ISO con offset (`2026-08-20T17:44:34+02:00`) |
| `ask_for_fix_verification_status` | string | `"UNKNOWN"` |

> NOTA de datos privados: el item real expone tu **programa privado** y tu
> **username** de hunter — el fixture los neutraliza, y la futura pestaña
> deberá tratar el contenido igual que los reportes locales (ruta segura,
> nunca al cliente/HTML/SSE sin sanitizar).

### Esquema de auth tras la renovación (2026-08-25)

Con el token renovado y guardado en Ajustes (UI → `.settings/ywh.json`):
`Authorization: Bearer` **vuelve a funcionar** (`/programs` → 200, 82
resultados). El `X-AUTH-TOKEN` del spec no fue necesario; usar `Bearer`
(consistente con el resto del proyecto). El token rechazado el 25/8 por la
mañana seguía siendo válido estructuralmente pero `Invalid JWT Token` en
todo → confirmado: **rotación de sesión** (el navegador había renovado el
access_token y dejado muerto el copiado); con un token copiado con la sesión
viva funciona a la primera.

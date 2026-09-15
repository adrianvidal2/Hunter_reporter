# YesWeHack API — verified contracts (block 9)

> Primary source: repo `yeswehack/yeswecaido` (cloned and read at checkpoint
> 9.0) **+ empirical verification with a real session on 2026-08-21**
> (step 9.1). Anonymized fixtures in `docs/fixtures/ywh/`.

## Authentication

**PAT not available**: the account used does not offer personal access tokens.
Final method (adjusted checkpoint 9.0): **hand-pasted session JWT**, exactly
like yeswecaido (localStorage → `access_token`).

- Scheme **empirically verified**: `Authorization: Bearer <JWT>` against
  `https://api.yeswehack.com` → HTTP 200. Same scheme as the plugin.
- **Short-lived**: the observed JWT carried `exp` ~1 h ahead. The main refresh
  path is the Settings UI (9.3).
- **Expiry detection**: before every call the `exp` claim of the payload is
  decoded (base64url, local, no request) and compared with the clock; expired
  → own error without spending the request. A 401 in responses gets the same
  treatment (invalid/expired token).
- Observed claims: `iat, exp, roles, email, totp_enabled`.
- **Token source precedence (9.3)**: UI → `.settings/ywh.json`
  (AES-256-GCM encrypted, infra from 8.1) **>** boot → `YWH_JWT` in
  `.env.local` (only if the encrypted file does not exist). Documented here as
  a contract.

## Public-only degradation (verified)

Without the header (or with an invalid token): HTTP 200 with **only public
programs** (observed: 63 results vs 82 with a valid JWT → 19 private ones
visible only with a token). The app degrades and warns; it does not break.

## `GET /programs?page=N` — paginated list ✅ verified

- `page` **starts at 1**; iterate until `pagination.nb_pages` (pagination in
  the body, not headers). Observed: `results_per_page: 42`.
- Response (see fixture `programs-page1.json`):

```jsonc
{
  "items": [ /* see below */ ],
  "pagination": { "page": 1, "nb_pages": 2, "results_per_page": 42, "nb_results": 82 }
}
```

- **Real item observed** (35+ fields; yeswecaido parsers cover a subset
  thanks to `.catch()`):
  `title, slug, country, activity_area, average_first_response_time, type
  ("bug-bounty"|"vdp-in-app"), status, demo, public, bounty, gift,
  hall_of_fame, hacktivity, report_collaboration_active, pid, secured,
  disabled, vdp, archived, reports_count, bounty_reward_min,
  bounty_reward_max, scopes_count, pentest_campaign_status, thumbnail, event,
  business_unit{…}, hunter_audience, scopes_enabled, last_update_at,
  report_submission_cost`
- **Drift caught live (9.4)**: `pid` arrives as **string** in the real API
  (parsers type it `string|number`). Fixtures were fixed to reflect it: if a
  fixture contradicts the API, the API wins.

## `GET /programs/{slug}` — detail ✅ verified

- **74 fields observed** (see fixture `program-detail.json`). Superset of
  yeswecaido's `programParser` with real additions: `vpn_outbound_ips,
  vpn_ips, vpn_active, sla_enabled, sla_grid, credit_balance, rights,
  attachments, systemic_issue_rule_*, leakage_rule_*, ywh_triager_user_agent…`
- Real `scopes[]` (richer than the plugin parser):
  `{ scope, scope_type, scope_type_name, asset_value, report_count }`
  (`report_count` may be `null`)
- Real `business_unit`: `{ name, slug, description, currency,
  already_activate_product, logo{…} }`
- `reward_grid_*` with `{ bounty_low, bounty_medium, bounty_high,
  bounty_critical }`; `stats` with `max_reward/average_reward` **nullable**
  (observed `null` on a public program).

## `GET /programs/{slug}` — detail verified LIVE (2026-08-25)

Tested against the real program `example-program` (private,
`public: false`, `bounty: true`, `type: bug-bounty`, `status: V`) with a fresh
session JWT → **HTTP 200, 15.5 KB, 74 fields** (matches
`ProgramBugBountyDetail` from the spec, see fixture `program-detail.json`).

### Scope in/out

- `scopes[]` (IN) — a single asset observed:
  `{ scope, scope_type: "web-application", scope_type_name: "Web application",
    asset_value: "HIGH", report_count: null }`
  → note the `asset_value` field (asset level/value) and `report_count`
  (nullable).
- `out_of_scope: string[]` — free text; real sample:
  `["All domains or subdomains not listed in the above list of 'Scopes'."]`

### Mandatory user-agent and VPN

- `user_agent: string` — **required UA**; in this program it is defined:
  `BugBounty-YWH-ExampleBrand` (format `BugBounty-YWH-<Brand>`). The spec
  types it `string` (may be `null` on other programs).
- `ywh_triager_user_agent: null` (triager field, nullable).
- `vpn_active: false`, `vpn_ips: null`, `restricted_ips: null`,
  `vpn_outbound_ips` not present (no VPN requirement here).

### Rules and access

- `rules` / `rules_html` (Markdown/HTML): description + rules; `rules_html`
  carries the render. Brand text stripped from the fixture.
- `account_access: "You can self-register."` (access policy).
- `supported_languages: ["GB"]`.

### Accepted/rejected vulnerability types

- `qualifying_vulnerability: string[]` — **accepted** (12 here): SQLi, XSS,
  RCE, IDOR, privilege escalation, auth bypass, business logic with real
  impact, file access (LFI/RFI/XXE/SSRF/XSPA), CORS with impact, CSRF with
  impact, Open Redirect, secrets in scope.
- `non_qualifying_vulnerability: string[]` — **rejected** (40 here):
  clickjacking, DoS, CVEs <30 days, self-XSS, missing headers, SPF/DKIM/DMARC,
  session mgmt, disclosures without PoC, blind SSRF without PoC,
  rate-limit findings, user enumeration, GraphQL introspection,
  coupons/promos, etc.

### Reward and other

- `bounty_reward_min: 50`, `bounty_reward_max: 1000`; real `reward_grid_high`
  `{50,300,700,1000}`; `reward_grid_*_null` nullable arrays.
- `stats: { max_reward:null, average_reward:null, average_first_time_response:1,
  total_reports, total_reports_last* , total_reports_current_month }`.
- `account_access`, `sla_grid:null`, `report_submission_cost`, flags
  `hunter_message_enabled`, `report_collaboration_active`, etc.

> **Private-data note**: the response exposes the private program (slug,
> BU "Example Brand", thumbnails `BRAND_*`, brand UA, real scope). The
> `program-detail.json` fixture neutralizes all those values (only enums and
> structure are preserved). Vulnerability types and rules are generic and
> non-identifying → kept literally.

## Observed errors

- `401` (garbage token): body `{"code":401,"message":"Invalid JWT Token"}`
- `404`: unknown slug (treated as `NotFound` in yeswecaido)
- Timeout / rate limit: **not observed** during testing (no `retry-after`
  header appeared); the client types them anyway just in case.

## Fixtures (contract for the Zod types of 9.2)

- `docs/fixtures/ywh/programs-page1.json` — 3 anonymized items:
  public bug-bounty · **private** bug-bounty · public vdp-in-app.
- `docs/fixtures/ywh/program-detail.json` — **full detail (74 fields)
  generated from the real program `example-program` (25/8) and
  anonymized**: scope `example-anonymized.com`, neutral BU ("Business Unit
  1"), UA `BugBounty-YWH-AnonymizedBrand`, thumbnail/banner/logos
  neutralized. Enums, structure and the accepted/rejected vulnerability types
  (generic, non-identifying) are preserved. **No real slugs, no real business
  units, no real domains, no brand text.**
- `docs/fixtures/ywh/openapi-v25.7.0.json` — **PUBLIC OpenAPI spec** of
  `api.yeswehack.com` (see below); a public YWH document, no user data, useful
  as a contract for any future step.

---

## Hunter's own reports — research (2026-08-25)

> Goal: find out whether MY reports' status is visible through the API.

### Finding 1: the API publishes its full OpenAPI (no auth)

- `GET https://api.yeswehack.com/doc` — ReDoc UI
- `GET https://api.yeswehack.com/doc.json` — OpenAPI 3.0 spec, **v25.7.0**,
  377 routes, 1.7 MB. Copied to `docs/fixtures/ywh/openapi-v25.7.0.json`.
- **Declared security scheme**: `PersonalAccessToken` = **apiKey in the
  `X-AUTH-TOKEN` header** (NOT `Authorization: Bearer`). Nuance: on 21/8 the
  session JWT worked with `Bearer` on `/programs` — the gateway accepted both
  schemes then; with the 25/8 token NEITHER worked (see lockout). For future
  steps: try `X-AUTH-TOKEN` first.

### Finding 2: route existence map (live probing)

401 (exists, protected) vs 404 (does not exist) — semantics validated with
controls (`/reports` gives 404 with and without token; `/programs` without
token gives 200 because it is public; corrupted signature → 401):

| Endpoint | Status | Notes |
|---|---|---|
| `GET /user/reports` | **EXISTS** (401) | NOT documented in the OpenAPI — internal frontend/mobile endpoint |
| `GET /reports/me` | **EXISTS** (401) | Same, undocumented |
| `GET /reports` | 404 | The general list is NOT exposed |
| `GET /hacktivity`, `/me`, `/users/me`, `/findings`, `/bugs`, `/user/findings`, `/user/programs`, `/user/balance`, `/user/payments`, `/hunter/reports`, `/my/reports`, `/profile` | 404 | Do not exist |
| `GET /reports/{id}` | **documented** | "Get report detail" · response `ReportDetail` (see below) |

### Finding 3: report shape (`ReportDetail`, 83 fields from the OpenAPI)

Everything the research asked for is in `GET /reports/{id}`:

| Dimension | `ReportDetail` fields |
|---|---|
| **Status** | `status.workflow_state` · `tracking_status` · `patch_status` · `triage_status` · `marked_as` · `seems_invalid` · `triaged` |
| **Program** | `program` (ProgramReport: `title, slug, public, bounty, bounty_reward_min, type, vdp…`) · `business_unit` |
| **Dates** | `created_at` · `accepted_at` · `resolved_at` · `expected_remediation_date` · `finding_detected_at` |
| **Severity** | `cvss` (`score, vector, criticity N/L/M/H/C, version`) · `bug_type` (CWE category) · `criticity` · `max_suggested_severity` |
| **Reward** | `reward` · `hunter_bounty_value` · `bonus` · `cvss_bonus` · `currency` · `bounty_allowed` |
| Useful extra | `title, scope, host, local_id, hunter, collaborators, attachments, tags, cve[], cwe[], rights[], user_roles[]` |

The LIST shape (`/user/reports`) is not in the OpenAPI (internal route); the
documented `ReportEmbed` is minimal (`id, local_id, title`). **VERIFIED LIVE
2026-08-25** — see next section.

## `GET /user/reports` — MY reports (list) ✅ verified live

**`/user/reports` is the correct endpoint** to list the authenticated
hunter's reports. It is not documented in the OpenAPI (internal
frontend/mobile endpoint), but it answers 200 with: `{ items[], pagination }`.

- **Pagination** (same structure as `/programs`): `page` starts at 1,
  `results_per_page: 50`, `nb_pages`, `nb_results`. Out-of-range `?page=N`
  → 200 with `items: []` (not 404). Fixture: `user-reports-item.json`.
- **`/reports/me` is NOT valid**: with a valid JWT it answers **404** (the
  previous day's 401 was a gateway artifact that protects routes before
  resolving). Ignore it.

```jsonc
{
  "items": [ /* item, below */ ],
  "pagination": { "page": 1, "nb_pages": 1, "results_per_page": 50, "nb_results": 19 }
}
```

**Real item (16 keys)** — see fixture `docs/fixtures/ywh/user-reports-item.json`
(anonymized; real enums, program/hunter/urls neutralized):

| Field | Type | Notes |
|---|---|---|
| `id`, `local_id` | int / string | `local_id` like `YWH-000000` |
| `title`, `scope` | string | this item already carries `title` (richer than the documented `ReportEmbed`) |
| `program` | object | Private program included: `title, slug, type ("bug-bounty"), status ("V"), public, bounty:true` |
| `status.workflow_state` | string | **status**, e.g. `"under_review"` |
| `cvss` | object | `{ criticity: "C", vector: "CVSS:3.1/…", score: 10, version: "v3.1" }` |
| `hunter` | object | `{ username }` (username only) |
| `reward`, `cost_credits`, `currency` | int / null / string | reward + currency (`EUR`) |
| `marked_as` | string | `"R"` (reported?) |
| `collaborative` | bool | |
| `created_at`, `changed_at` | string | ISO with offset (`2026-08-20T17:44:34+02:00`) |
| `ask_for_fix_verification_status` | string | `"UNKNOWN"` |

> Private-data note: the real item exposes your **private program** and your
> hunter **username** — the fixture neutralizes both, and the future tab must
> treat its content like local reports (safe path, never to the
> client/HTML/SSE unsanitized).

### Auth scheme after renewal (2026-08-25)

With the renewed token saved in Settings (UI → `.settings/ywh.json`):
`Authorization: Bearer` **works again** (`/programs` → 200, 82 results).
The spec's `X-AUTH-TOKEN` was not needed; use `Bearer` (consistent with the
rest of the project). The token rejected on the morning of the 25th was still
structurally valid but `Invalid JWT Token` everywhere → confirmed: **session
rotation** (the browser had renewed the access_token, leaving the copied one
dead); with a token copied while the session was alive it works first try.

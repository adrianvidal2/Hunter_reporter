# Intigriti Researcher API — verified contracts (checked live 2026-08-29)

> Research for the second platform. OpenAPI spec saved as a permanent fixture:
> `docs/fixtures/intigriti/intigriti-swagger-v1.0.json`
> (OpenAPI 3.0, version 1.0, 6 routes — "Researcher" API).
>
> Anonymized fixtures: `programs-page1.json` (list item) and
> `program-detail.json` (full detail with domains + ROE).

---

## ⛔ NO SUBMISSIONS IN THIS API (final answer — do not research again)

**The Intigriti researcher API does not expose your submissions or their
status.** The full spec (6 routes) only covers: programs (list/detail),
domains, rules-of-engagements, activities (program feed) and payouts (BETA).
There is no equivalent to YesWeHack's `GET /user/reports`, and no private
endpoint outside this spec for researchers. Any "submission tracking" would
have to be done outside the official API (web scraping), which is NOT the
plan. Closed.

## Base URL and auth (verified live ✅ 2026-08-29)

- Base: `https://api.intigriti.com/external/researcher`
- Auth: **`Authorization: Bearer <TOKEN>`** — verified live with a real token:
  `GET /v1/programs?limit=3&offset=0` → **HTTP 200**. The spec declares it as
  `bearerAuth` (HTTP Bearer); the token is a **long-lived PAT** (66 chars, not
  a short-lived session JWT like YWH's): created on the website
  (profile → API → researcher), does not expire every few hours.
- No auth / invalid token: **401** `{"code":"UNAUTH001","title":"Access
  denied.","status":401,"identifier":"<uuid>","extraParameters":{}}` (same
  body for any wrong scheme; the gateway does not reveal which one it expects).
- **No public endpoints**: without a token, `/v1/programs` is 401. YWH's
  "public-only" degradation does NOT exist here.

## Endpoints (all 6 from the spec)

| Method | Route | What it gives |
|---|---|---|
| GET | `/v1/programs` | Program list (summary, paginated) ✅ live |
| GET | `/v1/programs/{programId}` | Program **detail** ✅ live |
| GET | `/v1/programs/{programId}/domains/{versionId}` | Scope per version |
| GET | `/v1/programs/{programId}/rules-of-engagements/{versionId}` | Rules per version |
| GET | `/v1/programs/activities` | Program activity feed |
| GET | `/v1/payouts` | Payouts (BETA) |

## ⛔ Submissions: NOT exposed (final)

The researcher API does not expose my submissions or their status — no
endpoint for it exists in the spec (6 routes above) and no official
alternative private API exists. Equivalent of YWH's "my reports": **not
possible**. Only `payouts` (BETA) and `activities` (program feed, not
submissions).

## Pagination (verified live ✅)

By **offset**, not page: `limit` (0..500) + `offset`.

- `GET /v1/programs?limit=3&offset=0` → `{ "maxCount": 221, "records": [...] }`
- `offset=1&limit=1` → skips the first record (verified).
- `offset=9999` → **HTTP 200 with `records: []`** (graceful, like YWH).
- Iterate: `offset += limit` until `maxCount` records are gathered.

## LIST item (verified live, see anonymized fixture)

```jsonc
{
  "id": "uuid (programId for the detail)",
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

## Detail (verified live ✅, see anonymized fixture)

Fields: overview fields + `domains` and `rulesOfEngagement` embedded as
VERSIONS (with per-version endpoints too):

- `domains: { id, createdAt, content: Domain[] }` — **6 entries** in the
  tested program. Each domain: `{ id, type{id,value} (Wildcard/Url/…),
  endpoint, tier{id,value} (Critical/High/…/"No Bounty"), description,
  requiredSkills[] }`. **The IN scope is this list** (no structured in/out
  like YWH; out-of-scope lives in the rules).
- `rulesOfEngagement: { id, attachments[], createdAt, content }`:
  - `content.description` — full rules (markdown).
  - `content.testingRequirements`: **`userAgent`** (required User-Agent, may
    be `""`), **`requestHeader`** (e.g. `X-Intigriti-Username:
    {Username}` — alternative mandatory header), `intigritiMe` (bool),
    `automatedTooling` (int, tooling policy).
  - `content.safeHarbour` — legal protection (bool).

## Mapping to the Program tab (YWH → Intigriti)

| Concept | YWH | Intigriti |
|---|---|---|
| List | `/programs?page=N` `{items,pagination}` | `/v1/programs?limit&offset` `{maxCount,records}` |
| Detail | `/programs/{slug}` 74 fields | `/v1/programs/{programId}` (with versioned domains+ROE) |
| Scope IN | `scopes[]` | `domains.content[]` (endpoint, tier, type, description) |
| Scope OUT | `out_of_scope[]` | unstructured (in rules/description) |
| Rules | `rules`/`rules_html` | `rulesOfEngagement.content.description` |
| **User-Agent** | `user_agent` | `testingRequirements.userAgent` (+ `requestHeader`) |
| Reward grid | `reward_grid_*` per severity | ❌ no grid: only `minBounty`/`maxBounty` + domain `tier` |
| Severity | `cvss`/`criticity` | ❌ not exposed in the detail (assigned at submission) |
| My reports | `/user/reports` ✅ | **⛔ does not exist** (see above) |
| Auth | short-lived session JWT (Bearer) | long-lived PAT (Bearer) |

## Fixtures

- `intigriti-swagger-v1.0.json` — full public OpenAPI spec.
- `programs-page1.json` — anonymized list item (bug bounty with bounty +
  responsible disclosure without bounty; real types/status/confidentiality).
- `program-detail.json` — anonymized detail with 3 domains (wildcard
  critical, url high, wildcard no-bounty), full ROE with required userAgent,
  requestHeader and safeHarbour.

---

## Architecture notes for two platforms (recorded here)

Approved order 1-4 with three MANDATORY conditions:

1. **Step 1 = pure refactor** (YWH adapter → neutral model): zero new
   behavior, tests stay green, the YWH screen behaves exactly the same. Any
   visual change is a bug.
2. **Neutral model is NOT lossy**: the platform `raw` payload is ALWAYS kept
   in the model (raw alongside the neutral view) and the Program tab must be
   able to show platform-specific fields even when the neutral model does not
   carry them. Losing fields through the adapter is forbidden.
3. **Intigriti pagination**: by offset, limit up to 500; paginate until
   `maxCount` is exhausted, same pacing as YWH and a SAFETY CAP on iterations
   in case `maxCount` is inconsistent (never loop forever).

Also recorded above as final: **the API does not expose submissions**.

Agreed order: 1) YWH adapter → neutral (pure refactor) · 2) Intigriti module
(client+parsers+own render) · 3) tokens (one per platform) + Settings ·
4) Intigriti master tab + create project with `platform.json`.

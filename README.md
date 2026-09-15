# reporter

Local web app for managing bug bounty reports over a pre-existing folder of
files. The filesystem is the source of truth; everything else is a view or a
rebuildable index.

## Startup

```bash
pnpm install
pnpm dev        # http://127.0.0.1:3100 (localhost only)
```

Requires Node 22 + pnpm. Configuration lives in `.env.local`:

| Variable | Meaning |
|---|---|
| `REPORTS_ROOT` | Root folder holding the projects (`demo_project/REPORTES_YWH/*.pdf` + `demo_project/reportes/*.md`) |
| `API_TOKEN` | `Bearer` token for the ingestion API (generate with `openssl rand -hex 32`) |

If `REPORTS_ROOT` is missing or invalid, the app **refuses to start** (it fails
at boot with a clear message).

## Required structure

The git repo is `reporter-app/`; **data** (`reportes/`, sibling of the repo) is
never versioned (possible NDA). `.settings/` and `.env.local` (tokens and keys)
are not either: both are in the `.gitignore`.

```
proxectos/reporter/
├── reporter.sh                  # server management script (outside the repo)
├── README.md                    # this + structure map (outside the repo)
│
├── reportes/                    ← REPORTS_ROOT (.env.local): NEVER in the repo
│   ├── _inbox/                  # reports without a project (ingestion API)
│   ├── .config/                 # global templates and prompts
│   ├── .trash/ .history/        # trash and pre-save backups
│   └── <project>/               # one directory per program (slug)
│       ├── .config/platform.json    # platform (yeswehack|intigriti)
│       ├── programa.json            # program detail (platform GET)
│       ├── pentest/
│       │   ├── programa.md          # program report (generated, editable)
│       │   ├── recon/<tool>/<date>/ # recon outputs + run.json
│       │   └── launches.json        # agent launch history
│       ├── REPORTES_YWH/            # delivered PDFs (read-only in the app)
│       └── reportes/                # markdown drafts (what you edit)
│
└── reporter-app/                ← the git repo: CODE ONLY
    ├── src/
    │   ├── app/                 # Next routes (pages + server actions + API)
    │   │   ├── api/             # ingestion (v1), files (raw), events (SSE)
    │   │   ├── programas/       # multi-platform explorer (YWH | Intigriti)
    │   │   ├── escaneos/        # agents + recon module actions
    │   │   ├── cvss/            # CVSS 3.1 calculator
    │   │   └── ajustes/         # LLM, tokens, binary paths
    │   ├── components/          # UI (editor, explorers, panels)
    │   ├── core/                # pure domain, no Next → tests live here
    │   │   ├── fs/              # safe paths, tree, atomic, watcher, uploads
    │   │   ├── reports/         # front-matter, templates
    │   │   ├── llm/ ywh/ intigriti/ programs/ recon/ cvss/ orca/ prompts/ db/
    │   ├── server/              # live server state (watcher, recon runner,
    │   │                        #   orca, scans)
    │   └── lib/                 # env, autosave, secrets (AES-256-GCM)
    ├── docs/                    # verified API contracts + fixtures
    ├── scripts/                 # migrations (e.g. platform.json)
    ├── .env.local               # NEVER in the repo
    └── .settings/               # NEVER in the repo (encrypted tokens/keys)
```

Rules: `reportes/` is not versioned (the app recreates it if missing); the
SQLite index is rebuildable (`pnpm run db:reset`); tests use temporary
directories and never touch the real `reportes/`.

## What's inside

- **Explorer**: projects with counters, delivered PDFs (dedicated viewer with
  pagination/zoom, uploads via drag & drop) and markdown drafts (CodeMirror
  editor + sanitized preview, autosave, `.history/` backups, `.trash/`)
- **Ingestion API** (`/api/v1/*`, see `docs/api-ingesta.md`): your scripts
  drop reports over HTTP; the watcher detects external files
- **Pending reports**: human-in-the-loop approval before anything runs
- **Report templates + LLM rewriting** (OpenAI-compatible providers) with
  diff view and guardrails
- **Multi-platform programs** (YesWeHack | Intigriti) over a neutral model;
  tokens encrypted in `.settings/`
- **CVSS 3.1 calculator** (FIRST spec, NIST-style UI)
- **Recon**: launches whitelisted installed tools against program scope with
  safe execution, risk levels and full run tracing

## Multi-platform

YesWeHack and Intigriti share a neutral model (`core/programs/types.ts`): the
platform raw payload always travels intact (no-lossy condition) and each
platform has its own client, parsers, adapter and render under `core/`.
Program sub-tabs and each project's Program/Recon tabs read the project's
`platform.json` to know which platform they work with.

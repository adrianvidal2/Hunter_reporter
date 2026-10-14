# Tarea 6 (epic) — Base de conocimiento (KB) estilo Agent Skills

Epic partido en mini-tareas validables de forma independiente (`06a`–`06d`). Plan completo:
`~/.claude/plans/rustling-sniffing-meteor.md`.

## Idea
KB reutilizable para **agentes** y **reportes**, formato **Agent Skills** (`SKILL.md`), dos
ámbitos (global / proyecto, precedencia proyecto>global como `findTemplate`), discovery por
**índice de descripciones** (progressive disclosure, sin infra). RAG/GraphRAG y puente a
`orca skills` quedan como fase futura sobre este mismo sustrato.

## Formato de entrada (compartido por todas las mini-tareas)
Carpeta `<slug>/SKILL.md`: front-matter `name` (lowercase-hyphen) + `description` ("qué +
cuándo") + `category` (`tecnica|reporte`) + `tags?`; cuerpo lean; `references/` plano bajo demanda.

## Reutilizar (no reinventar)
`core/prompts/prompts.ts` (CRUD markdown `.config/`, slug, `.trash`), `core/reports/templates.ts`
(dos ámbitos + precedencia), `core/reports/frontmatter.ts` (`splitFrontMatter`/`unquote`),
`core/fs/*` (`writeAtomic`, `resolveSafe*`, `trashFile`, `sanitizeFilename`),
`components/prompts-manager.tsx` + `app/prompts/actions.ts` + `components/sidebar.tsx`.

## Orden y dependencias
1. **06a — Núcleo KB** (base; sin dependencias).
2. **06b — Página «Conocimiento»** (depende de 06a).
3. **06c — Consumidor agentes** (depende de 06a).
4. **06d — Consumidor reportes** (depende de 06a).

Cada mini-tarea lleva sus **tests en profundidad** y su **checklist de validación** en su
propio fichero; reporter valida cada una en verde antes de la siguiente.

## Fase futura (NO en este epic, se planifica aparte si interesa)
Puente a `orca skills install`; RAG/**GraphRAG** sobre KB + `findings`; selector de modelo por
agente (acotado a agentes compatibles).

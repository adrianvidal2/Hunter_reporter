# Tarea 10 (epic) — Correlación cross-proyecto

Vista read-only de "qué hay nuevo y jugoso" across TODOS los programas, con **SQL sobre
`findings`** (el "grafo pobre" del estudio `docs/kb-retrieval-study.md`). Sin infra nueva.
Partido en `10a`–`10b`.

## Idea
Tus datos ya son relacionales en SQLite (`findings`: project/template/host/severity…). Una
consulta cross-proyecto da el 80% del "multi-salto" sin GraphRAG: findings por severidad across
programas, hosts/assets nuevos (del diffing 9b si existe), patrones repetidos entre targets.

## Reutilizar
`findings`/`listFindings` (`db/findings.ts`), `openDb`/drizzle, patrón de página read-only
(`reports-list`/`scans-table`). Si 9b existe, también su store de novedades.

## Orden y dependencias
1. **10a** — Queries SQL de correlación (puro/db, testeable).
2. **10b** — Página read-only de correlación.

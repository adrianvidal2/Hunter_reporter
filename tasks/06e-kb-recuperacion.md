# Tarea 6e — Recuperación KB (FTS5 sobre `reporter.db`)

Parte de la [Tarea 6](06-base-conocimiento.md). Depende de **06a**. Fundamento: estudio
`docs/kb-retrieval-study.md` (RAG vs GraphRAG → léxico-primero local).

## Objetivo
Recuperación declarativa eficiente sobre la KB (y, opcionalmente, los `findings`) usando
**FTS5/BM25 en el `reporter.db` existente**: sub-ms, sin modelo, sin datos fuera. Vectores y
GraphRAG quedan como fases futuras (ver estudio).

## Ficheros
- `src/db/schema.ts` + migración (FTS5 virtual table) — índice RECONSTRUIBLE desde el markdown
  de la KB y los `findings` en disco.
- `src/db/kb-index.ts` (nuevo): `rebuildKbIndex()` (puebla desde `listKbIndex`/`loadKbEntry` de
  06a, chunks pequeños y enfocados) + `searchKb(query, { category?, project?, limit? })`
  (BM25, con `AND/OR/NOT` y prefijos de FTS5).
- Reutiliza `openDb` y el patrón transacción de `src/db/pending.ts`/`reindex.ts`.

## Notas de diseño (del estudio)
- Léxico-primero: FTS5 gana en tokens exactos (CVE, cabeceras, params). No embeddings en v1.
- Chunks pequeños (~300-400 chars) rinden mejor; inserts por lotes.
- El índice es reconstruible (el markdown/los findings son la verdad), coherente con `reindex()`.

## Tests en profundidad (`src/db/kb-index.test.ts`, tmpdir)
- `rebuildKbIndex` puebla desde la KB; borrar y repoblar → idéntico (reconstruible).
- `searchKb` encuentra por término exacto (CVE/cabecera) y respeta `category`/`project`.
- Aislamiento: una búsqueda con `project` no devuelve KB de otro proyecto.
- Query vacía / sin resultados → `[]` sin romper; term con sintaxis FTS rara no revienta.

## Validación (comprobada 2026-10-15)
- [x] Suite completa verde: **89 ficheros, 719 tests** (+13 de `kb-index.test.ts`), exit 0.
- [x] `npx tsc --noEmit` y `npx eslint` limpios.
- [x] **Migración 0005 (FTS5)** aplica limpia — ejercida al abrir BD temporal; tabla virtual
      `kb_fts` (slug/scope/category UNINDEXED; title/description/text indexados, pesos BM25 5/3/1).
- [x] `rebuildKbIndex` puebla desde TODOS los ámbitos, es **reconstruible** (vaciar+repoblar →
      idéntico), e indexa entradas sin cuerpo por title/description.
- [x] `searchKb`: término exacto (CVE con guiones) vía fallback literal; sintaxis FTS5
      (prefijos/AND); dedup por entrada; filtro `category`; **aislamiento** por `project`;
      query vacía/sin resultados/sintaxis rota → `[]` sin romper; ranking título/desc > cuerpo.
- [x] `chunkBody` (~350, por párrafos + corte duro). Usa tmpdir + dbPath: no toca datos reales.
- [x] Núcleo/db puro (sin UI) → no hay paso manual pendiente; validación completa.

### Nota honesta
`searchKb`/`rebuildKbIndex` son el **motor** de recuperación, aún **sin consumidor** cableado
(ningún código no-test lo llama todavía). Indexar `findings` quedó como extensión futura (la
tarea lo marcaba opcional). Enganchar la búsqueda a agentes/reportes/triaje sería tarea aparte.

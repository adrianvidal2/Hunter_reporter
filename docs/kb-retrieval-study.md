# Estudio: recuperación para la base de conocimiento (RAG vs GraphRAG)

> Decisión de diseño para la KB (ver `tasks/06-base-conocimiento.md` y el plan). Criterio
> rector: **eficiencia** (coste, latencia, mantenimiento) en una app **local**, con el **FS
> como verdad**, SQLite (`reporter.db`) ya en uso, datos de objetivo bajo **NDA**.

## Veredicto

**GraphRAG clásico NO encaja hoy.** Lo eficiente: seguir con **skills + índice de
descripciones** (conocimiento procedimental, sin infra) y, cuando haga falta recuperar hechos,
**RAG local léxico-primero en SQLite (FTS5/BM25)**, añadiendo vectores (`sqlite-vec` + RRF)
solo si aparecen huecos semánticos. Para lo "multi-salto", **SQL sobre `findings`** — la
estructura que GraphRAG construiría ya existe en el esquema.

## Números (2026)

- **Indexar GraphRAG: 300x–2.000x más caro** que vector RAG (benchmark MS/LazyGraphRAG:
  ~1.000x; ~$1.544 vs ~$1.45 por millón de tokens). Causa: extracción LLM de entidades/
  relaciones (~58% de los tokens); lee cada chunk ≥2 veces + un informe por comunidad.
- **Actualización incremental = su punto débil** (en MS GraphRAG, "compleja"). El recon
  **cambia constantemente** → re-extraer es un killer.
- **FTS5/BM25 en SQLite: sub-ms, sin modelo**, y gana a los vectores en **tokens exactos**
  (CVE, cabeceras, parámetros, versiones) — crítico en seguridad; hasta **250x** más eficiente
  que embeddings para routing/matching exacto. Embeddings añaden ~50ms (dominan la latencia).
- Patrón local eficiente: **FTS5 + sqlite-vec + RRF en un único `.db`**, reservando embeddings
  para lo que de verdad necesita semántica.

## Por qué este caso descarta GraphRAG

1. **Los datos ya están estructurados**: `findings` (`project,template,host,severity,matchedAt`)
   y recon (`scope→host→endpoint`) ya son un grafo en SQLite → SQL con JOINs da el multi-salto
   a coste ~0. GraphRAG aporta estructura a texto NO estructurado; aquí es redundante.
2. **Corpus pequeño y local**: playbooks curados + hallazgos; sin volumen que justifique el pipeline.
3. **NDA/privacidad**: la indexación GraphRAG manda datos del objetivo a un LLM. FTS5 = cero ML,
   cero datos fuera.
4. **FS como verdad**: un único `.db` reconstruible encaja; GraphRAG mete grafo+vectores+
   resúmenes+mantenimiento.

## Escalera de eficiencia recomendada

| Nivel | Qué | Coste | Cuándo |
|---|---|---|---|
| 1 | Skills + índice de descripciones | ~0 | Procedimental (agentes). Ya en el plan. |
| 2 | **FTS5/BM25 en `reporter.db`** (KB + findings) | ~0, <1ms | Búsqueda declarativa/exacta. El salto natural (tarea 6e). |
| 3 | + `sqlite-vec` + RRF (híbrido) | bajo (~50ms, modelo local) | Solo si el léxico falla en recall. |
| 4 | SQL sobre `findings` ("grafo pobre") | ~0 | Multi-salto relacional. |
| 5 | **LazyGraphRAG** (query-time, ~0.1% del coste de GraphRAG) | medio | Sensemaking global sobre corpus grande no estructurado (futuro lejano). |

## Encaje en el harness

Capa de recuperación (no motor aparte): módulo puro `core/kb/retrieve.ts` + índice FTS5 en el
**`reporter.db` existente** (reconstruible desde el markdown de la KB y los `findings`,
coherente con `reindex()`). Alimenta a los consumidores ya planeados (lanzar agentes,
reportes) y opcionalmente al triaje de recon. Rendimiento: FTS5 <1ms sin cargar nada → v1 solo
con FTS5 probablemente basta; vectores quedan como interruptor opcional. Privacidad: todo local.

## Disparador para reconsiderar GraphRAG
Muchos reportes/recon de muchos programas + necesidad de *sensemaking global* sobre texto no
estructurado. Entonces **LazyGraphRAG** (no el clásico) sobre KB + findings. Hasta ahí, SQL +
FTS5 es más rápido, barato y privado.

## Fuentes
- GraphRAG vs Vector RAG, el bill de índice: https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026
- Cuándo se paga el grafo: https://dev.to/saurabh_naik_b213f3bbeafe/graphrag-vs-vector-rag-when-the-knowledge-graph-pays-for-itself-3386
- Graph RAG en producción (2026): https://www.paperclipped.de/en/blog/graph-rag-production/
- Cuándo se justifica el coste de GraphRAG: https://theneuralbase.com/graphrag/learn/advanced/when-graphrag-cost-is-justified/
- SQLite FTS5 vs vector DBs: https://dev.to/cagrik34/i-ditched-cloud-vector-databases-for-sqlite-fts5-and-my-rag-pipeline-got-10x-better-759
- Búsqueda híbrida FTS5 + Vector + RRF: https://ceaksan.com/en/hybrid-search-fts5-vector-rrf

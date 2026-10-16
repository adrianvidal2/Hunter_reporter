-- Índice de texto completo de la KB (Tarea 6e). Léxico-primero (FTS5/BM25):
-- sub-ms, sin modelo, sin datos fuera del disco (ver docs/kb-retrieval-study.md).
--
-- Tabla VIRTUAL standalone: slug/scope/category UNINDEXED (solo filtros);
-- title/description/text INDEXADOS — la descripción es la capa de discovery
-- del 06a y también se busca. El índice es RECONSTRUIBLE: `rebuildKbIndex()`
-- (src/db/kb-index.ts) lo vacía y repuebla desde el markdown de la KB — el
-- disco es la verdad, coherente con reindex().
CREATE VIRTUAL TABLE `kb_fts` USING fts5(
  `slug` UNINDEXED,
  `scope` UNINDEXED,
  `category` UNINDEXED,
  `title`,
  `description`,
  `text`
);

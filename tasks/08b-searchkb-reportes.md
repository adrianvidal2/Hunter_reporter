# Tarea 8b — searchKb en la reescritura de reportes

Parte de la [Tarea 8](08-conectar-kb.md). Depende de 6e (searchKb) + 6d (kbContext en rewrite).

## Objetivo
En la reescritura/borrador, recuperar automáticamente entradas KB `reporte` relevantes
(remediaciones, referencias, patrones) y pasarlas como `kbContext` — sin que el usuario tenga
que marcarlas a mano (aunque la selección manual de 6d sigue disponible).

## Ficheros (propuesta)
- `src/server/generate-rewrite.ts`: derivar query del reporte (título/secciones/CWE) →
  `searchKb(query, {project, category:'reporte', limit})` → unir con los slugs elegidos a mano
  → `renderKbContext`/`kbContext` al `rewriteReport` (bloque `CONOCIMIENTO_KB` ya blindado en 6d).

## Tests en profundidad
- Query recupera `reporte` relevantes; se unen con la selección manual sin duplicar.
- Sin hits ni selección → sin bloque KB (prompt idéntico al base).
- El bloque sigue blindado (test adversario de 6d no regresa).

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **96 ficheros, 794 tests** (+3 de 8b), exit 0; `tsc`/`eslint` limpios.
- [x] `buildReportKbQuery` (puro): identificadores CVE/CWE primero + título (front-matter) +
      encabezados; stopwords del vocabulario de reporte, min-len, tope 12, OR. Vacío → `''`.
- [x] `generateRewriteFor`: `rebuildKbIndex` + `searchKb(category:'reporte', limit 5)` →
      `autoSlugs`; **unión sin duplicar** con la selección manual de 6d; try/catch →
      la recuperación **nunca bloquea** la reescritura; sin hits ni selección → `kbContext` vacío.
- [x] El bloque va blindado (el `CONOCIMIENTO_KB` de 6d; test adversario de 6d no regresa).
- [x] Server con fetch inyectable → sin datos reales. La verificación en navegador de la
      reescritura es la deuda manual ya anotada en 6d (misma UI); 8b no añade pantalla nueva.

# Tarea 8a — searchKb en el triaje

Parte de la [Tarea 8](08-conectar-kb.md). Depende de 6e (searchKb) + 7d/4 (triaje).

## Objetivo
Antes de que el validador LLM juzgue un finding/primitiva, recuperar de la KB las entradas
`tecnica` relevantes (FTS5) e inyectarlas como **contexto de referencia** (DATO, blindado).

## Ficheros (propuesta)
- `src/server/derive-primitives.ts` (y/o `core/recon/classify.ts`): antes del `chatCompletion`,
  construir una query desde el finding (template-id/host/kind) → `searchKb(query, {project,
  category:'tecnica', limit})` → añadir los hits al prompt dentro de un bloque delimitado+nonce.
- Reutiliza `searchKb` (`db/kb-index.ts`) y el patrón de bloque de `core/recon/primitives.ts`.

## Tests en profundidad
- La query recupera entradas relevantes; se inyectan como DATO (escapadas + nonce), no instrucciones.
- Sin hits → prompt sin bloque KB (compat); con hits → bloque presente.
- Contenido KB adversario (delimitadores/órdenes) no rompe el bloque.
- El coste extra es acotado (limit de hits).

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **96 ficheros, 791 tests** (+7 de 8a), exit 0; `tsc`/`eslint` limpios.
- [x] `buildKbQuery` (puro): deriva la query FTS de kinds de secretos + segmentos de path (OR,
      stopwords, min-len, tope 12).
- [x] `buildPrimitivesPrompt` con `kbContext`: bloque `KB_CONTEXTO` con tag propio + nonce +
      `escapeTag` (blindado); regla 5 del system (material de referencia, DATO); sin contexto →
      **sin bloque** (compat). Test adversario: cierres/apertura falsa/órdenes no rompen el bloque.
- [x] `derive-primitives`: `rebuildKbIndex` + `searchKb(project, 'tecnica', limit 5)` antes de
      juzgar; cargado como DATO blindado. Envuelto en try/catch → **cualquier fallo de
      recuperación = sin contexto, nunca bloquea el triaje**. Sin hits → prompt sin bloque.
- [x] Núcleo + server con fetch inyectable → sin datos reales; sin paso manual pendiente.

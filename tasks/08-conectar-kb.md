# Tarea 8 (epic) — Conectar la KB (searchKb + feedback loop)

Cierra hilos ya construidos: `searchKb` (6e, FTS5) existe pero **no tiene consumidor**, y el
**feedback 7→KB** quedó como futuro. Partido en `08a`–`08c`.

## Idea
- La KB deja de ser un almacén pasivo: **alimenta el triaje y los reportes** (recuperación
  automática de contexto relevante) y **se retroalimenta** con lo que se confirma.
- Determinista/recuperación primero, LLM como siempre (leads). Anti-inyección en cada inyección
  de contexto (el contenido recuperado puede venir de la KB de proyecto = datos del objetivo).

## Reutilizar
`searchKb`/`rebuildKbIndex` (`db/kb-index.ts`, 6e), `classify`/`derive-primitives` (triaje 7d/4),
`generate-rewrite` + `buildRewritePrompt(kbContext)` (6d), `createKb` (6a), `escapeTag` (prompt.ts).

## Orden y dependencias
1. **08a** — `searchKb` en el triaje (recuperar KB antes de juzgar).
2. **08b** — `searchKb` en la reescritura (auto-contexto `reporte`).
3. **08c** — Feedback loop: **promover a KB** un finding/primitiva confirmado (humano).

## Decisión marcada (puedes corregir)
- **08c**: feedback vía **acción humana "promover a KB"** (limpia, con tu clic), NO auto-captura
  de la salida del agente Orca (difícil/fuzzy). La auto-captura queda para una fase posterior.

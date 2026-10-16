# Tareas — Pipeline de recon + diffing + findings

Desglose de trabajo acordado. Cada tarea es un fichero con: objetivo, ficheros a tocar,
utilidades a reutilizar, pasos, **tests en profundidad** y un **checklist de validación**
(se marca al terminar; la validación final la hago yo revisando que todo pase).

Plan general (contexto y decisiones): `~/.claude/plans/rustling-sniffing-meteor.md`.

## Regla transversal
Cada tarea **debe** llevar tests en profundidad (no humo): casos límite, rechazos,
idempotencia y el camino feliz. Nada se marca como hecho con tests en rojo o parciales.

## Invariantes a respetar en TODA tarea
- Lista blanca de herramientas (`getTool` en `src/core/recon/tools.ts`).
- Rutas siempre con `resolveSafe` / `resolveSafeAllowMissing` (`src/core/fs/paths.ts`).
- Escritura atómica (`writeAtomic`), borrado a `.trash/`, nunca `unlink`.
- Gate de reglas (`needsGate`): activo/explotación no se lanza sin confirmación salvo
  autorización explícita.
- El contenido de recon es NO confiable (viene del objetivo): cualquier uso con LLM lleva
  el blindaje anti-inyección de `src/core/llm/prompt.ts`.

## Estado

| # | Tarea | Estado |
|---|---|---|
| — | Diffing: núcleo + lector (`core/recon/diff.ts`, `server/recon-diff.ts`) | ✅ hecho (14 tests) |
| 1 | UI del diffing | ✅ hecho (action + panel + 6 tests; validación final pendiente) |
| 2 | Pipeline determinista | ✅ hecho (plan + orquestador + UI + 24 tests; validación final pendiente) |
| 3 | Vista de findings (nuclei) | ✅ hecho (parser + tabla findings + borrador + 19 tests; validación final pendiente) |
| 4 | Clasificador LLM (aparcado) | ✅ hecho (triaje + pre-filtro + anti-inyección + 20 tests; validación final pendiente) |
| 5 | Higiene (EPIPE, aislar `.settings`, limpiar `dbg`) | ✅ hecho (5.1 en Tarea 2 + test regresión; 5.2 verificado con checksums; 5.3 `dbg*`/`v.mts.run` eliminados) |
| 6 | **Base de conocimiento (KB)** — epic (`SKILL.md`, 2 ámbitos, discovery por índice) | ✅ hecho (6a–6e completadas; validación final pendiente) |
| 6a | Núcleo KB (`core/kb/kb.ts`) | ✅ hecho (CRUD 2 ámbitos + índice + render + 15 tests; validación final pendiente) |
| 6b | Página «Conocimiento» (UI + actions) | ✅ hecho (actions + /kb + gestor + sidebar + 5 tests; validación final pendiente) |
| 6c | Consumidor agentes (adjuntar `tecnica` al prompt) | ✅ hecho (sección Conocimiento en wizard + applyKbToPrompt + renderKbContextAction + 5 tests; validación final pendiente) |
| 6d | Consumidor reportes (insertar `reporte`) | ✅ hecho (selector en reescritura + bloque CONOCIMIENTO_KB blindado + 8 tests; validación final pendiente) |
| 6e | Recuperación KB (FTS5 sobre `reporter.db`) | ✅ hecho (migración FTS5 + rebuild/search BM25 + 13 tests; validación final pendiente) |
| 7 | **Auditoría guiada por reconstrucción de JS** — epic (A determinista + B agente, por relevo) | ✅ hecho (7a–7e completadas; validación final pendiente) |
| 7a | Recolección JS + reconstrucción de sourcemaps | ✅ hecho (núcleo puro + harvest con coverage + 18 tests; validación final pendiente) |
| 7b | Endpoints/params → OpenAPI (+ huecos) | ✅ hecho (extractor puro + openapi.json/gaps.json en harvest + 10 tests; validación final pendiente) |
| 7c | Secretos accionables en JS | ✅ hecho (reglas + entropía + filtro ruido + integración harvest/secrets.json + 14 tests; validación final pendiente) |
| 7d | Primitivas + hipótesis (validador LLM → KB) | ✅ hecho (pre-filtro determinista + LLM leads + KB proyecto + 15 tests; validación final pendiente) |
| 7e | Semilla de misión + handoff al agente | ✅ hecho (mission.ts + buildMissionAction + botón en wizard + 9 tests; validación final pendiente) |

# Tarea 9b — Diff automático → novedades + SSE

Parte de la [Tarea 9](09-monitorizacion.md). Depende de 9a + diffing (recon-diff).

## Objetivo
Tras cada ciclo del scheduler, diffear contra el run anterior y registrar las **novedades**
(assets/hosts/URLs nuevos) + avisar por el canal SSE existente.

## Ficheros (propuesta)
- Enganche en `src/server/recon-scheduler.ts`: tras el run, `diffLatestReconRuns(project, tool)`
  (reusa `server/recon-diff.ts`) para las herramientas diffeables.
- Store de novedades: tabla SQLite `recon_news` (índice reconstruible) o json por proyecto —
  con timestamp, herramienta, items nuevos.
- Broadcast por el SSE de `watcher-service` (o eventos de recon) para el badge/aviso.

## Tests en profundidad
- Primer ciclo (sin anterior) → no inventa novedades; segundo con assets nuevos → los registra.
- Sin cambios → sin novedades, sin ruido.
- El broadcast emite al suscriptor (patrón de `watcher-service.test`).

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **100 ficheros, 828 tests**, exit 0; `tsc`/`eslint` limpios.
- [x] Tabla `recon_news` (migración 0006, índice reconstruible); `recordReconNews` idempotente
      por (proyecto, tool, item); aislamiento por proyecto/herramienta; items vacíos ignorados;
      `listReconNews` orden/limit; `clearReconNews` (no es fuente de verdad).
- [x] En el ciclo del scheduler: `diffLatestReconRuns` por herramienta diffeable → asset nuevo
      se registra y notifica; **sin cambios → sin ruido** (test).
- [x] **SSE**: `notifyReconNews` emite por el canal del `watcher-service`; si el servicio no
      existe para el root, no revienta.
- [x] Server/db con dependencias inyectables → sin datos reales; sin paso manual pendiente.

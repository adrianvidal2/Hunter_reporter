# Tarea 9c — Vista de novedades

Parte de la [Tarea 9](09-monitorizacion.md). Depende de 9b.

## Objetivo
Pantalla donde ver las novedades de monitorización (global + por proyecto) y el estado del
scheduler (qué proyectos están opt-in, último ciclo), con control para activar/desactivar.

## Ficheros (propuesta)
- Server actions para listar novedades + toggle opt-in/intervalo por proyecto.
- Página/panel (patrón de `scans-table`/`reports-list`): novedades recientes, con enlace al run.
- Badge/aviso vía el SSE de 9b (como el contador de Pendientes).

## Tests en profundidad
- Actions: listar novedades y toggle de config (opt-in/intervalo) con validación de proyecto.
- (UI sin test unitario: `tsc`/`eslint` + validación manual, como el resto de paneles.)

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **100 ficheros, 828 tests**, exit 0; `tsc`/`eslint` limpios.
- [x] Actions (`novedades/actions.test.ts`): `getScheduleStatus`, `setSchedule` (toggle opt-in/
      intervalo con validación de proyecto), `runCycleNow`, `listReconNews`, `clearReconNews`,
      `stopScheduler` — probadas sobre las capas de 9a/9b.
- [x] Página `/novedades` + panel + entrada en sidebar; aviso por el SSE de 9b (`tsc`/`eslint` ok).
- [ ] **Manual pendiente** (`pnpm dev`): activar monitorización en un proyecto; tras un ciclo
      con asset nuevo, la novedad aparece en la vista y en el aviso. (Actions testeadas; la
      página/panel no tienen test unitario.)

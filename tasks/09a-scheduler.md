# Tarea 9a — Scheduler de recon pasivo

Parte de la [Tarea 9](09-monitorizacion.md).

## Objetivo
Un scheduler in-app que, por proyecto opt-in, re-lanza el recon **pasivo/ligero** en intervalo.
NUNCA lanza etapas activas/explotación (esas siguen con gate humano).

## Ficheros (propuesta)
- `src/core/recon/schedule.ts` (puro): modelo de config (proyecto, intervalo, enabled) +
  decisión "qué toca lanzar ahora" (solo etapas de riesgo passive/light del `planPipeline`).
- `src/server/recon-scheduler.ts`: singleton `globalThis` (patrón `recon-runner`/`watcher-service`);
  timer que, por proyecto habilitado, lanza SOLO pasivo/ligero vía `getReconRunner`.
- Config persistida en `.settings/recon-schedule.json` (opt-in explícito).
- Arranque en `src/instrumentation.ts` (una vez por proceso).

## Tests en profundidad
- La planificación elige SOLO etapas passive/light; jamás active/exploitation (verificado por risk).
- Proyecto no opt-in → no se lanza nada.
- Intervalo respetado (reloj inyectable); no solapa ciclos del mismo proyecto.
- Arranque idempotente (singleton; hot-reload no duplica).

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **100 ficheros, 828 tests**, exit 0; `tsc`/`eslint` limpios.
- [x] **REGLA SAGRADA** doblemente probada: `passiveLightStages` filtra por `getTool().risk`
      (núcleo) y el ciclo del servidor SOLO lanza esas etapas (test: jamás nuclei/sqlmap); lanza
      con `confirmed:false` y el gate del pipeline es segunda defensa.
- [x] Opt-in por proyecto (sin activar → NADA); intervalo respetado (reloj inyectado,
      `lastCycleAt` corrupto → corre); **no solape** (reserva síncrona `runningProjects`);
      `markCycled` aun en fallo (no martillea). Config tolerante (clamp al mínimo, rutas raras fuera).
- [x] Singleton `globalThis` hot-reload safe; arranca en `instrumentation.ts`.
- [x] Núcleo + server con dependencias inyectables → sin datos reales; sin paso manual pendiente.

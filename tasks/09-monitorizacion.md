# Tarea 9 (epic) — Monitorización continua

Re-lanzar recon **pasivo/ligero** por proyecto en intervalo → **diff** → avisar de superficie
nueva. Superficie nueva = donde está el bug. Partido en `09a`–`09c`.

## Regla sagrada (no se negocia)
- **Solo pasivo/ligero en automático.** Lo activo/explotación NUNCA se auto-lanza; eso sigue
  con clic humano (gate). Opt-in **por proyecto**, respetando rate/UA del programa.

## Decisión marcada (puedes corregir)
- **Scheduler in-app** (singleton en `globalThis`, mismo patrón que `recon-runner`/
  `watcher-service`), no cron externo. Arranca en `instrumentation.ts`.

## Reutilizar
`recon-pipeline`/`planPipeline` (etapas pasivas), `getReconRunner`, `diffLatestReconRuns`
(`server/recon-diff.ts`, diffing), el canal SSE de `watcher-service`/eventos de recon.

## Orden y dependencias
1. **09a** — Scheduler/runner (config opt-in por proyecto + intervalo; lanza solo pasivo/ligero).
2. **09b** — Diff automático tras cada ciclo → store de **novedades** + broadcast SSE.
3. **09c** — Vista de novedades (global + por proyecto).

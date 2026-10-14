# Tarea 1 — UI del diffing

## Objetivo
Enseñar en pantalla lo que `diffLatestReconRuns` ya calcula: qué assets son NUEVOS respecto
al run anterior (subdominios, hosts vivos, URLs).

## Ya hecho (base)
- `src/core/recon/diff.ts` (puro) + `src/core/recon/diff.test.ts`
- `src/server/recon-diff.ts` (`diffLatestReconRuns`) + `src/server/recon-diff.test.ts`

## Ficheros a tocar
- `src/app/escaneos/recon-actions.ts` — nueva server action `diffReconAction(project, toolId)`.
- `src/components/recon-panel.tsx` — sección "Cambios desde el último run".

## Reutilizar
- `diffLatestReconRuns` (`src/server/recon-diff.ts`), `isDiffableTool` (`src/core/recon/diff.ts`).
- Patrón de acción/estado del propio `recon-panel.tsx` (`listReconRunsAction`, `useState`).

## Pasos
1. `diffReconAction`: envuelve `diffLatestReconRuns(project, toolId, getEnv().REPORTS_ROOT)`
   y devuelve el `ReconDiffResult`. Mismo estilo que `listReconRunsAction`.
2. En el panel, bajo "Runs": selector con SOLO herramientas diffeables (`isDiffableTool`),
   botón "Comparar". Pinta `added` en verde, `removed` tachado/rojo, contador de `unchanged`.
   Mensaje claro cuando `ok:false` (reason del resultado).

## Tests en profundidad
- **Server action** (vitest, patrón `launches.test.ts` con `vi.mock('@/lib/env')` + tmpdir):
  - dos runs de subfinder → `ok:true`, `added` correcto, refs de los dos dirs más recientes.
  - un solo run → `ok:false`, reason "dos runs".
  - herramienta no diffeable (nmap) → `ok:false`, reason "comparable".
  - herramienta fuera de lista blanca → `ok:false`, reason "lista blanca".
  - proyecto sin runs de esa tool → `ok:false`, reason "sin runs".
- **Núcleo/lector**: ya cubierto (14 tests) — no regresar.

## Validación (comprobada 2026-10-14)
- [x] `npx vitest run` de los 3 ficheros (diff, recon-diff, recon-actions) → **20 tests verdes**.
- [x] `npx eslint` limpio en los 5 ficheros tocados.
- [x] `npx tsc --noEmit` sin errores (cubre el panel cliente, que no tiene test).
- [x] No se rompe el panel existente: tipos + lint OK; la sección de diffing es aditiva
      (nuevo estado/efecto, no toca lanzar/histórico/sqlmap-dalfox).
- [ ] **Manual pendiente** `pnpm dev`: con ≥2 runs de subfinder, el panel lista los nuevos;
      con <2, el aviso. (Requiere un proyecto real con programa sincronizado; verificado por
      lectura del código, no ejecutado en navegador.)

# Tarea 13 — Barra de progreso (auditoría + pipeline)

Una **barra segmentada que se va poniendo verde** según avanza el flujo. En **dos sitios**:
la **auditoría completa** (3 fases: recon·misión·agente) y el **pipeline de recon** (una
etapa por herramienta). Cero backend nuevo: se deriva del estado que los paneles ya consultan.

## Modelo común (pure, testeable)
`src/core/recon/progress.ts`:
- `type SegState = 'done' | 'current' | 'pending' | 'error'`
- `interface ProgressSegment { label: string; state: SegState }`
- `auditPhaseProgress(phase)` → 3 segmentos (Recon/Misión/Agente) desde el `phase` de 12b
  (`recon|mision|agente|done|cancelled|error`). `done` → los 3 `done`; `cancelled`/`error` →
  el segmento donde paró en `error`, los previos `done`, los siguientes `pending`.
- `pipelineProgress(plannedToolIds, snapshot)` → un segmento por etapa planificada. Mapea los
  `snapshot.stages[].status` (`done/error/empty/gate/cancelled/skipped`) a `SegState`; la etapa
  que corre ahora (sin outcome aún y con pipeline `running`) = `current`; las que no empezaron
  = `pending`.

## UI
- `src/components/progress-bar.tsx` (nuevo, reutilizable): pinta los segmentos —
  `done` verde, `current` verde a medias/parpadeo, `pending` gris, `error` rojo — con etiqueta.
- Enganche en `src/components/audit-panel.tsx` (barra de 3 fases) y
  `src/components/recon-pipeline.tsx` (barra por etapa). Ambos ya tienen el estado por polling.

## Reutilizar
`AuditState.phase` (12b), `PipelineSnapshot.stages` (task 2), el polling existente de ambos paneles.

## Tests en profundidad (`src/core/recon/progress.test.ts`)
- `auditPhaseProgress`: `recon`→[current,pending,pending]; `mision`→[done,current,pending];
  `agente`→[done,done,current]; `done`→[done,done,done]; `cancelled`/`error` en fase X → X
  `error`, previos `done`, siguientes `pending`; valor desconocido/null → tolerante.
- `pipelineProgress`: etapas con outcome mapeadas (done/error/skipped…); la que corre →
  `current`; las no empezadas → `pending`; sin stages → todas `pending`; pipeline `done`/`stopped`
  refleja bien el último estado.

## Validación (comprobada 2026-10-17)
- [x] Suite completa verde: **883 tests** (+14 de 13), exit 0; `tsc`/`eslint` limpios.
- [x] `auditPhaseProgress`: cada fase (recon/mision/agente), `done`→3 verdes; `cancelled`/`error`
      con `lastRunningPhase` → paró DONDE estaba (error + previos done + resto pending), y SIN
      él → al principio; desconocido/null → todo pending.
- [x] `pipelineProgress`: hechas done / la que corre current / no empezadas pending; outcomes
      `empty/gate/cancelled`→error (paró ahí), `skipped`→pending; NO running → sin current;
      labels legibles; planned vacío → [].
- [x] Wiring: `audit-panel.tsx` (lleva `lastRunningPhase` para el error honesto) y
      `recon-pipeline.tsx` pintan `<ProgressBar>` con el helper. Component `progress-bar.tsx`.
- [ ] **Manual pendiente** (`pnpm dev`): la barra se pone verde fase a fase (auditoría) y etapa
      a etapa (pipeline); en error/cancelado marca dónde paró. (Helper testeado; la barra/UI no.)

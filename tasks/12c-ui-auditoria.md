# Tarea 12c — UI de auditoría completa

Parte de la [Tarea 12](12-auditoria-completa.md). Depende de 12b.

## Objetivo
Botón **"Auditoría completa"** que dispara el orquestador, con las dos vías (con recon / sin
recon), estado en vivo del flujo y **kill switch**.

## Ficheros (propuesta)
- Server actions: `startAuditAction(project, { runRecon })`, `getAuditStatusAction`,
  `cancelAuditAction` (envuelven el orquestador 12b); editar la config 12a.
- UI en la pestaña Programa/Recon: botón + selector con/sin recon + barra de estado (recon →
  misión → agente) + botón **Cancelar** (kill switch). Aviso informativo del estado de reglas
  del programa (sin bloquear).

## Tests en profundidad
- Actions: `startAuditAction` con/sin recon delega bien; `cancel` corta; validación de proyecto.
- (UI sin test unitario: `tsc`/`eslint` + validación manual, como el resto de paneles.)

## Validación (comprobada 2026-10-17)
- [x] Suite completa verde: **105 ficheros, 869 tests**, exit 0; `tsc`/`eslint` limpios.
- [x] Actions (`audit-actions.test.ts`): `startAuditAction` con/sin recon delega al orquestador;
      proyecto inexistente → error ANTES de tocar el orquestador; `cancelAuditAction` /
      `getAuditStatusAction` (kill switch + estado); `getAuditRulesInfoAction` (aviso
      **informativo**, el flujo no frena); set/get de la config 12a.
- [x] Panel `audit-panel.tsx` cableado en la pestaña Programa (`project-program-tab.tsx`);
      `tsc`/`eslint` limpios.
- [ ] **Manual pendiente** (`pnpm dev`): "Auditoría completa" con recon encadena
      recon→misión→agente; "sin recon" va directo; kill switch cancela; el aviso de reglas se ve
      pero no frena. (Actions testeadas; el panel no tiene test unitario.)

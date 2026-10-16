# Tarea 12a — Config de auditoría por proyecto

Parte de la [Tarea 12](12-auditoria-completa.md). Base; se configura UNA vez.

## Objetivo
Guardar por proyecto lo que el operador define una vez: la **plantilla de misión/prompt**, el
**agente** (provider + modelo si lo soporta), el **presupuesto** y si el flujo **corre recon o
lo salta**.

## Ficheros (propuesta)
- `src/core/recon/audit-config.ts` (puro): tipos + normalización tolerante (como
  `core/recon/schedule.ts`/`settings.ts`): `{ enabled, runRecon, agent, model?, promptTemplate?,
  budget: { tokens?, timeMs?, maxAgents? } }`.
- Persistencia en `.settings/audit.json` (opt-in explícito; sin secretos).
- La plantilla de misión por defecto = la de 7e (`DEFAULT_MISSION_TEMPLATE`), editable por proyecto.

## Tests en profundidad
- Normalización: defaults sensatos; valores raros → defaults; presupuesto clampa a límites.
- `runRecon` y `agent` se respetan; proyecto sin config → deshabilitado.
- Round-trip load/save estable.

## Validación (comprobada 2026-10-17)
- [x] Suite completa verde: **105 ficheros, 869 tests** (+26 de epic 12), exit 0; `tsc`/`eslint` limpios.
- [x] `normalizeProjectAudit`: vacío → deshabilitado, `runRecon:true` por defecto (auditoría
      COMPLETA), agent `pi`, budget defaults; `runRecon:false`/agent/model respetados; tipos
      raros → defaults; proyectos con rutas raras descartados.
- [x] **Presupuesto clampado** (min/max): `timeMs`, `maxAgents`, `tokens`; merge parcial del budget.
- [x] Persistencia `.settings/audit.json`: sin fichero → deshabilitado; corrupto → deshabilitado
      (opt-in: sin config no corre nada); round-trip estable; `setProjectAudit` merge+clamp.
- [x] Núcleo puro + persistencia con tmpdir → sin datos reales; sin paso manual pendiente.

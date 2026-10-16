# Tarea 7e — Semilla de misión + handoff al agente

Parte de la [Tarea 7](07-auditoria-js.md). Depende de **07b-d** + **6c**.

## Objetivo
Ensamblar la **misión** para el agente: el prompt real del usuario como PLANTILLA,
auto-rellenado con el OpenAPI (07b) + primitivas/hipótesis (07d) + secretos (07c) +
**cobertura/huecos** (07a-b), para que el agente **ataque los huecos** y lo activo. Es el
relevo A→B.

## Alcance / decisiones
- Plantilla de misión editable (parte de `tasks/` / KB): base = el prompt real (scope, objetivo
  SQLi, reglas "no borrar cuenta", playwright para DOM, reconstruir OpenAPI, secretos
  accionables…). Se rellenan placeholders con la salida determinista.
- **Marcar explícitamente los huecos** ("endpoints dinámicos sin resolver", "JS sin sourcemap")
  para enfocar al agente donde el código no llegó.
- Lanzamiento = humano, reutilizando el asistente Lanzar (6c `applyKbToPrompt` / `launch.ts`).
- El activo (probar SQLi, registrar cuenta, DOM) lo hace el agente tras el clic humano.

## Ficheros (propuesta)
- `src/core/recon/mission.ts` (puro): ensamblado de la misión (plantilla + datos → prompt).
- Enganche en el asistente Lanzar / `launch.ts` para preseleccionar la misión.

## Tests en profundidad
- La misión incluye EXACTAMENTE el OpenAPI/primitivas/huecos dados; sin datos → plantilla base.
- Los huecos aparecen señalados para el agente.
- No se lanza nada solo: ensamblar ≠ ejecutar (el disparo sigue siendo humano).

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **96 ficheros, 784 tests** (+9 de 7e), exit 0; `tsc`/`eslint` limpios.
- [x] `buildMission` (puro, reutiliza `renderTemplate`): incluye EXACTAMENTE los datos dados
      (openapi/primitivas/hipótesis/secretos/huecos); sección HUECOS siempre presente;
      placeholders consumidos (sin `{{}}` residual); plantilla editable; la plantilla por
      defecto recoge el prompt real (OpenAPI, secretos, SQLi solo-lectura, DOM, no borrar cuenta).
- [x] **ensamblar ≠ ejecutar**: `buildMission`/`buildMissionAction` devuelven TEXTO; no lanzan
      nada. `buildMissionAction` localiza el harvest más reciente, lee artifacts + cobertura
      (huecos js-sin-sourcemap) + scope de programa.json + KB 07d, y arma la misión.
- [x] Enganche en el wizard Lanzar: botón "cargar misión" rellena el prompt (el disparo del
      worktree sigue siendo humano, vía `launchOrcaAction`).
- [ ] **Manual pendiente** (`pnpm dev`): con un proyecto que tenga harvest de JS, el botón
      rellena el prompt con OpenAPI/primitivas/huecos y se puede lanzar al agente. (Verificado
      por lectura + tests de núcleo/action; el wizard no tiene test unitario.)

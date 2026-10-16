# Tarea 12b — Orquestador de auditoría completa

Parte de la [Tarea 12](12-auditoria-completa.md). Depende de 12a + recon-pipeline + 7e + agentes.

## Objetivo
Tras un disparo humano, encadenar la auditoría desatendida:
`[recon pipeline (confirmed:true) | saltar]` → `buildMission` → `launchOrcaAction`.

## Diseño
- `src/server/audit-orchestrator.ts`: singleton/registro por proyecto (patrón `recon-pipeline`).
  - Si `runRecon`: `startPipeline({ ..., stages: <plan completo>, confirmed: true })` (el clic
    humano ya autorizó; **sin gate**, operador manda) → esperar `done`.
  - Siempre: `buildMission` (plantilla de 12a + artifacts del harvest si hay) → `launchOrcaAction`
    con el agente/modelo de 12a.
  - **Kill switch**: `cancelPipeline` + no lanzar el agente; estado consultable.
  - **Presupuesto**: respetar topes de 12a (tiempo de ciclo, nº de agentes).
- Reglas del programa: `prohibido/silencio/autorizado` se **registran** (traza), NO bloquean.

## Tests en profundidad (runner/exec inyectados)
- Flujo con recon: corre el pipeline y DESPUÉS lanza el agente con la misión ensamblada.
- **Saltar recon**: va directo a misión→agente (misión desde artifacts existentes o base).
- Kill switch a mitad → cancela el pipeline y NO lanza el agente.
- Reglas en "prohibido" → **NO frena** (operador manda), pero queda en la traza.
- Presupuesto excedido → corta.

## Validación (comprobada 2026-10-17)
- [x] Suite completa verde: **105 ficheros, 869 tests**, exit 0; `tsc`/`eslint` limpios.
- [x] **Con recon**: pipeline COMPLETO con `confirmed:true` y DESPUÉS el agente con la misión.
- [x] **Saltar recon**: directo a misión→agente, sin pipeline.
- [x] **CONTROL DEL OPERADOR probado**: reglas en `prohibido` → se registran en `rulesVerdict`
      pero **NO frenan** (operador manda).
- [x] **Kill switch**: a mitad de recon cancela el pipeline y NO lanza el agente; cancel sin
      auditoría activa → false.
- [x] **Presupuesto**: tiempo agotado durante recon → corta sin agente; `maxAgents` define
      cuántos agentes; guard anti-busy-loop.
- [x] **Opt-in**: sin `enabled` → error claro y NADA se lanza.
- [x] Deps inyectables (pipeline/mission/orca/context/sleep/now) → sin red ni datos reales; sin paso manual.

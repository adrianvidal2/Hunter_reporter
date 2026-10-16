# Tarea 12 (epic) — Auditoría completa orquestada

De un solo disparo humano, encadenar **recon → misión → lanzar agente** para hacer el pentest
de un tirón. Con opción de **saltarse el recon** e ir directo a lanzar el agente. Partido en
`12a`–`12c`.

## Decisión del operador (acordada — mandas tú)
- **El clic inicial ES la autorización.** El orquestador corre desatendido tras ese clic.
- **Control total del operador:** NO hay bloqueo ni gate. El estado de reglas del programa
  (`assessAutomatedTooling`: prohibido/silencio/autorizado) es **informativo como mucho**, NUNCA
  frena. El orquestador lanza el recon con `confirmed:true` (tú ya confirmaste al lanzar).
- **Disparo:** solo botón "Auditoría completa" (no desatendido por scheduler).

## Guardarraíles que SÍ se quedan (operativos, no de permisos)
- **Opt-in/config por proyecto** (plantilla de misión/prompt + agente + presupuesto).
- **Presupuesto**: tope de tokens/tiempo/nº de agentes.
- **Kill switch**: cancela el pipeline en curso y no lanza más (el agente ya lanzado se
  gestiona desde Escaneos/Orca).

## Reutilizar
`startPipeline`/`getPipeline`/`cancelPipeline` (`server/recon-pipeline.ts`), `buildMission`/
`buildMissionAction` (7e), `launchOrcaAction` (agentes), config al estilo `recon-scheduler`.

## Orden y dependencias
1. **12a** — Config de auditoría por proyecto (plantilla + agente/modelo + presupuesto + recon sí/no).
2. **12b** — Orquestador (server): botón → [recon pipeline confirmado | saltar] → misión → agente.
3. **12c** — UI: botón "Auditoría completa" (con/sin recon) + estado en vivo + kill switch.

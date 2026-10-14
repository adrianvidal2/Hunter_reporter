# Tarea 6c — Consumidor: agentes (asistente Lanzar)

Parte de la [Tarea 6](06-base-conocimiento.md). Depende de **06a** (y se apoya en 06b para crear
contenido).

## Objetivo
Que al lanzar agentes se pueda adjuntar conocimiento `tecnica` (global + del proyecto) al
prompt, vía el índice de descripciones (el usuario elige qué entradas).

## Ficheros
- `src/components/launch-wizard.tsx`: en el paso 2, sección "Conocimiento" con el índice
  `tecnica` (global+proyecto) y sus descripciones; marcar entradas.
- `src/app/proyectos/[project]/launch.ts` (o la propia action del wizard): `renderKbContext`
  de las entradas marcadas se **añade al prompt** del agente (reutiliza el mecanismo
  `promptByLabel`/editor; agnóstico del agente, vale para todos).

## Reutilizar
`listKbIndex`/`renderKbContext` (06a); `launch-form.ts` (agentes/prompts).

## Tests en profundidad
- `core/ywh/launch-form.ts` o helper puro: el prompt final = prompt base + contexto de las
  entradas EXACTAMENTE marcadas; sin marcar → prompt intacto.
- Que las entradas de proyecto solo salen para ESE proyecto (aislamiento, apoyado en 06a).

## Validación (la hace reporter)
- [ ] Suite verde + exit 0; `tsc`/`eslint` limpios.
- [ ] Manual: marcar 1-2 skills `tecnica` en el Lanzar → el prompt enviado al agente las
      incluye; sin marcar nada, el prompt no cambia.

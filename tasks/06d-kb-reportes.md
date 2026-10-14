# Tarea 6d — Consumidor: reportes (reescritura/borrador)

Parte de la [Tarea 6](06-base-conocimiento.md). Depende de **06a** (y 06b para crear contenido).

## Objetivo
Apoyar la redacción de reportes con entradas `reporte` (remediaciones, referencias, patrones):
insertarlas como contexto/boilerplate en el borrador o en la reescritura LLM.

## Ficheros
- Vista de reescribir (`app/proyectos/[project]/reescribir/[file]/…`) y/o
  `src/server/generate-rewrite.ts`: selector del índice `reporte` (global+proyecto); las
  entradas elegidas se insertan en el borrador o se pasan como contexto a la reescritura.

## Reutilizar
`listKbIndex`/`renderKbContext` (06a); mecánica de plantillas/placeholders existente
(`core/reports/templates.ts`, `core/reports/placeholders.ts`).

## Tests en profundidad
- El borrador/contexto incluye EXACTAMENTE las entradas `reporte` elegidas; vacío si no se elige.
- No se mezclan entradas `tecnica` aquí (filtro por categoría).
- Si entra en el prompt de reescritura, respeta el blindaje anti-inyección ya existente.

## Validación (la hace reporter)
- [ ] Suite verde + exit 0; `tsc`/`eslint` limpios.
- [ ] Manual: insertar una entrada `reporte` en un borrador → aparece su contenido; el flujo de
      reescritura sigue funcionando.

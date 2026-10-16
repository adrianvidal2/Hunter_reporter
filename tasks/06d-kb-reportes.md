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

## Validación (comprobada 2026-10-15)
- [x] Suite completa verde: **88 ficheros, 706 tests** (+5), exit 0; `tsc --noEmit` y `eslint` limpios.
- [x] **Anti-inyección**: `CONOCIMIENTO_KB` añadido a `TAG_NAMES` (delimitadores escapados),
      va con el nonce, y reglas 9/10 del system lo tratan como DATO/material de referencia.
      Test adversario: contenido KB con `</CONOCIMIENTO_KB>` + órdenes no cierra ni falsifica el bloque.
- [x] Threading verificado: `reescribir/page.tsx` carga `listKbIndex({project, category:'reporte'})`
      → `rewrite-review.tsx` (marca slugs) → `generateDraftRewriteAction(path, tpl, kbSlugs)` →
      `generateRewriteFor` → `renderKbContext` → `rewriteReport({kbContext})` → `buildRewritePrompt` blindado.
- [x] Tests: slugs marcados llegan como `kbContext` al LLM; sin marcar → sin bloque (compat).
- [ ] **Manual pendiente** (`pnpm dev`): marcar una entrada `reporte` en la vista de reescribir
      → el LLM la usa como referencia (Remediation/References); el flujo sigue funcionando.
      (Verificado por lectura + tests; la UI `rewrite-review.tsx` no tiene test unitario.)

### Nota honesta
Se relajó a propósito la regla 9 del system para permitir integrar referencias del bloque KB.
Consecuencia: `review.ts` marcará esas URLs/refs venidas de KB como "añadidas" (posible
alucinación) en el diff — no es bug, es el humano confirmando (coherente con el resto).

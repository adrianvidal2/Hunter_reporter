# Tarea 11 — Agrupar la KB por tag/categoría (facetado)

El primer escalón (barato) de la "vista por grafos": agrupar las entradas KB por **tag** y/o
**categoría** — "XSS → estas entradas". SIN grafo dibujado, sin LLM, sin infra: puro
facetado sobre lo que `listKbIndex` ya devuelve (`category` + `tags`).

## Prerrequisito honesto
Para agrupar por tag útilmente, las entradas necesitan tags. 7d y 8c los ponen solos, pero el
editor manual de `/kb` hoy solo expone nombre/descr/categoría/cuerpo → **hay que exponer `tags`
en el editor** (el modelo `KbInput`/`createKb`/`updateKb` ya los acepta).

## Objetivo
1. Editar `tags` desde `/kb` (entrada de etiquetas).
2. Ver las entradas **agrupadas** por tag o por categoría, con el nº por grupo.

## Ficheros (propuesta)
- `src/core/kb/facet.ts` (nuevo, PURO): `groupKbEntries(entries, { by: 'tag' | 'category' })`
  → grupos ordenados `{ key, entries[] }`. Una entrada con varios tags aparece en varios grupos;
  sin tags → grupo `(sin etiqueta)`.
- `src/components/kb-manager.tsx`: input de `tags` en el editor + selector "agrupar por
  tag/categoría" que pinta los grupos (reutiliza el índice que la página ya carga).
- (Sin ruta nueva: se queda en `/kb`.)

## Reutilizar
`listKbIndex` (6a, ya trae `category` + `tags`), `createKb`/`updateKb` (aceptan `tags`),
`kb-manager.tsx` (6b).

## Tests en profundidad (`src/core/kb/facet.test.ts`)
- Agrupar por tag: entrada con 2 tags sale en los 2 grupos; conteos correctos.
- Agrupar por categoría: `tecnica`/`reporte` separadas.
- Entradas sin tags → grupo `(sin etiqueta)`; lista vacía → `[]`.
- Orden estable (alfabético de clave, o por nº — definir y testear).

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **102 ficheros, 843 tests** (+8 de 11), exit 0; `tsc`/`eslint` limpios.
- [x] `groupKbEntries` (puro): por TAG = faceto (entrada con 2 tags → 2 grupos; sin tags →
      `(sin etiqueta)`); por CATEGORÍA = partición (`tecnica`/`reporte`); orden alfabético
      estable (locale es, numérico); lista vacía → `[]`; las entradas agrupadas son las
      ORIGINALES (no copias parciales).
- [x] `kb-manager.tsx`: input de `tags` en el editor (split por comas) + selector
      `agrupar por none/tag/categoría` que pinta los grupos con `groupKbEntries`.
- [ ] **Manual pendiente** (`pnpm dev`): en `/kb` añadir tag `xss` a una entrada y verla
      agrupada bajo «xss»; cambiar a agrupar por categoría. (Lógica pura testeada; la UI no.)

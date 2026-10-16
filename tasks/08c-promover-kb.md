# Tarea 8c — Feedback loop: promover a KB (humano)

Parte de la [Tarea 8](08-conectar-kb.md). Depende de 6a (createKb).

## Objetivo
Cerrar el círculo "crear primitivas": que un **finding/primitiva/lead confirmado** se **promueva
a la KB** del proyecto (o global) con un clic — para que la próxima auditoría parta de más.

## Decisión marcada
Feedback vía **acción humana explícita** ("promover a KB"), NO auto-captura de la salida del
agente Orca (queda para fase futura). Coherente con "nada se promueve solo".

## Ficheros (propuesta)
- Server action `promoteToKbAction(project, payload, scope)`: toma un finding/primitiva/hipótesis
  y crea una entrada KB (`createKb`, categoría `tecnica` por defecto, tags de origen).
- Botón "Promover a KB" en: tabla de findings (recon), vista de triaje, y/o entradas 07d.
- Reutiliza `createKb` (6a) y `rebuildKbIndex` (6e) para que quede buscable.

## Tests en profundidad
- Promover crea la entrada KB con los datos correctos (scope, categoría, tags, cuerpo).
- Idempotencia/colisión de slug → sufijo o error claro (reusa el manejo de 6a).
- Nada se promueve sin la acción (no hay camino automático).
- Tras promover, `searchKb` la encuentra (si se reindexa).

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **96 ficheros, 799 tests** (+5 de 8c), exit 0; `tsc`/`eslint` limpios.
- [x] `promoteToKbAction` = **SOLO acción humana** (no hay camino automático; la KB arranca vacía
      y el único modo de poblarla desde findings es el clic). Valida scope + no-vacío.
- [x] Crea la entrada con scope/categoría/tags (`promovido`, `origen:<source>`) + cabecera de
      **trazabilidad** (origen, sourceRef, fecha) + cuerpo.
- [x] Colisión de slug → **sufijo automático** (`-2`, `-3`): promover lo mismo dos veces no es
      error. Scope global OK; scope inexistente / payload vacío → error claro.
- [x] Tras promover, **reindexa el FTS** → `searchKbAction` la encuentra al instante (bucle cerrado).
- [x] Botón "Promover a KB" en la tabla de findings (`recon-findings.tsx`); `createKb` (6a) reutilizado.
- [ ] **Manual pendiente** (`pnpm dev`): "Promover a KB" desde un finding → aparece en `/kb` y
      es recuperable. (Action testeada; el botón de la tabla no tiene test unitario.)

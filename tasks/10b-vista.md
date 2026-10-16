# Tarea 10b — Vista de correlación

Parte de la [Tarea 10](10-correlacion.md). Depende de 10a.

## Objetivo
Página read-only que pinta la correlación: findings por severidad across programas, recientes,
y patrones repetidos entre targets (enlazando al proyecto/finding de origen).

## Ficheros (propuesta)
- `src/app/correlacion/page.tsx` (`force-dynamic`): llama a las queries de 10a server-side.
- Componente de tabla/resumen (patrón `reports-list`/`scans-table`).
- Entrada en `src/components/sidebar.tsx`.

## Tests en profundidad
- (UI sin test unitario: `tsc`/`eslint` + validación manual.) La lógica va en 10a (testeada).

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **101 ficheros, 835 tests**, exit 0; `tsc`/`eslint` limpios.
- [x] Página `/correlacion` (`force-dynamic`) llama a las queries de 10a server-side; entrada
      «Correlación» en el sidebar. La lógica va en 10a (testeada).
- [ ] **Manual pendiente** (`pnpm dev`): la vista muestra findings por severidad across
      proyectos y los patrones repetidos; los enlaces llevan al origen. (La página no tiene
      test unitario; sus datos sí.)

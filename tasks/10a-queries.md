# Tarea 10a — Queries de correlación (SQL sobre findings)

Parte de la [Tarea 10](10-correlacion.md).

## Objetivo
Funciones de consulta cross-proyecto sobre `findings` (y novedades si 9b existe): agregados por
severidad across programas, findings recientes, templates/patrones repetidos entre targets.

## Ficheros (propuesta)
- `src/db/correlation.ts`: queries read-only sobre `findings` con drizzle/SQL:
  - `findingsBySeverityAcrossProjects()` → conteos por severidad y proyecto.
  - `recentFindings(limit)` → últimos findings de todos los proyectos.
  - `repeatedTemplates()` → mismo `template_id` en ≥2 proyectos (patrón reutilizable).
- Reutiliza `openDb`/esquema de `findings` (6a/3). CERO escritura (solo lectura).

## Tests en profundidad
- Agregados correctos con fixtures multi-proyecto (tmpdir + db temporal).
- `repeatedTemplates` detecta solo los que cruzan proyectos; únicos no.
- BD vacía → resultados vacíos sin romper.

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **101 ficheros, 835 tests** (+7 de 10), exit 0; `tsc`/`eslint` limpios.
- [x] `findingsBySeverityAcrossProjects` (conteos por proyecto+severidad, del más grave al leve)
      + `projectSeverityCount` consistente; `recentFindings` (lastSeenAt DESC + límite, mezclando
      proyectos).
- [x] `repeatedTemplates`: SOLO `template_id` en ≥2 proyectos (únicos y mismo-proyecto-dos-veces
      NO cuentan); `maxSeverity` correcta; BD vacía → `[]`.
- [x] **SOLO LECTURA** verificado por test (las filas siguen exactamente igual tras las queries);
      grep confirma cero INSERT/UPDATE/DELETE. Sin UI → sin paso manual pendiente.

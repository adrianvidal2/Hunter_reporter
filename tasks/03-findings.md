# Tarea 3 — Vista de findings (empezar por nuclei)

## Objetivo
Parsear la salida de recon (nuclei primero) a una lista de findings, verla agregada, dedup,
y poder crear un borrador de reporte desde un finding.

## Ficheros a tocar / crear
- `src/core/recon/findings.ts` (NUEVO, PURO) — parser de la salida JSON de nuclei →
  `Finding[]` (template-id, host, severidad, matched-at, nombre), dedup por `template+host`.
- `src/db/schema.ts` — tabla `findings` (índice RECONSTRUIBLE, estilo del resto del esquema).
- `src/db/migrations/` — `pnpm db:generate`.
- `src/db/findings.ts` (NUEVO) — upsert idempotente + listado (estilo `src/db/pending.ts`).
- `src/components/` — panel/tabla de findings en la pestaña Recon; botón "crear borrador".
- Server actions en `src/app/escaneos/recon-actions.ts`.

## Reutilizar
- `DEFAULT_TEMPLATE` / `renderTemplate` (`src/core/reports/templates.ts`,
  `src/core/reports/placeholders.ts`) para el borrador.
- `openDb` / patrón transacción de `src/db/pending.ts`.
- `resolveSafe*` para leer los `output.log`.

## Tests en profundidad
- **Parser (`findings.test.ts`, puro)**:
  - varias líneas JSON de nuclei válidas → findings correctos.
  - línea malformada / vacía → se ignora sin romper.
  - dedup por `template+host` (dos hits iguales → 1).
  - severidades (info/low/medium/high/critical) mapeadas.
  - campos ausentes → defaults tolerantes (no crash), estilo parsers YWH.
  - entrada que NO es de nuclei → `[]`.
- **`findings.ts` (db, tmpdir)**:
  - upsert idempotente: mismo finding dos veces → 1 fila.
  - listado por proyecto/severidad.
  - reconstruible: borrar y repoblar desde disco.
- **Crear borrador**:
  - rellena `DEFAULT_TEMPLATE` con los datos del finding; placeholders sin dato quedan visibles.
  - escribe con `writeAtomic` en `reportes/` del proyecto (no pisa si colisiona → sufijo).

## Validación (comprobada 2026-10-14)
- [x] Suite completa verde: **86 ficheros, 658 tests**, exit 0.
- [x] Parser (`findings.test.ts`, 9 casos): válidas en orden, malformada/vacía ignorada,
      dedup por template+host, mismo template en otro host = 2, severidades + desconocido→info,
      defaults tolerantes sin crash, host deducido de matched-at, no-nuclei→[], sin template-id→ignorada.
- [x] DB (`db/findings.test.ts`): upsert idempotente (firstSeen se conserva), no mezcla
      proyectos, listado por severidad, rebuild reconstruible (borrado a mano → repoblado
      idéntico), proyecto sin runs, output.log malformado tolerado.
- [x] Migración 0003 aplica limpia — ejercida al abrir la BD temporal en los tests de db
      (no se tocó la `reporter.db` real).
- [x] Crear borrador (`recon-actions.test.ts`): rellena `DEFAULT_TEMPLATE`, sufijo `-2` en
      colisión, rechaza template/host vacíos y proyecto inexistente; `writeAtomic` + `markOwnWrite`.
- [x] `npx tsc --noEmit` sin errores; `npx eslint` limpio en los ficheros de la tarea.
- [ ] **Manual pendiente** `pnpm dev`: un run de nuclei aparece en la tabla; "crear borrador"
      genera un `.md` editable en Borradores. (Verificado por lectura + tests, no en navegador.)

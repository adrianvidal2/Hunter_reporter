# Tarea 5 — Higiene (recomendada antes de iterar sobre el runner)

## Objetivo
Dejar la base fiable: el suite debe salir en verde Y con exit 0, y los tests no deben tocar
datos reales.

## 5.1 — EPIPE no capturado
- **Síntoma**: `npx vitest run` pasa los 589 tests pero sale con exit ≠ 0 por un EPIPE no
  atrapado en `src/server/recon-runner.ts:524` (`proc.stdin?.write(...)` sobre un proceso que
  ya murió; el `try/catch` síncrono no atrapa el error asíncrono del socket de stdin).
- **Arreglo**: atar un handler `error` al stream de stdin (`proc.stdin?.on('error', …)`) para
  tragar EPIPE/ECONNRESET; mantener el `try/catch` para el write síncrono.
- **Test de regresión**: spawn (inyectado) de un proceso que cierra stdin / muere antes del
  write → el run termina en su estado y NO se emite un error no capturado.

## 5.2 — Aislar `.settings/` en los tests
- **Síntoma**: `src/server/recon-runner.test.ts` y `src/server/dbg2.test.ts` llaman a
  `saveReconSettings` sin redirigir `settingsDir()` → escriben en el `.settings/recon.json`
  REAL del usuario (ya lo corrompió una vez). Contradice la invariante "los tests usan tmpdir
  y nunca tocan datos reales".
- **Arreglo**: redirigir `settingsDir` a un tmpdir, como hace `src/core/recon/settings.test.ts`
  (mock de `process.cwd` o del módulo). Confirmar que tras el suite `.settings/` del repo
  queda intacto.

## 5.3 — Limpiar restos de depuración
- Eliminar: `dbg.test.ts` (raíz), `src/dbg.test.ts`, `src/server/dbg2.test.ts`, `v.mts.run`.
- Son tests de `console.log` con `expect(true).toBe(true)`; no aportan cobertura.

## Validación (comprobada 2026-10-14)
- [x] **5.1 EPIPE** arreglado: handler `proc.stdin?.on('error', () => {})` en
      `recon-runner.ts:615` + test de regresión ("el binario muere antes de leer stdin → run
      'done', sin excepción no capturada"). La suite sale con **exit 0**.
- [x] **5.2 `.settings/` aislado**: `recon-runner.test.ts` hace `process.chdir` a un tmpdir en
      `beforeAll` → `settingsDir()` (= `cwd/.settings`) cae en el tmpdir. Probado: md5 de
      `.settings/{recon,llm,ywh}.json` IDÉNTICO antes y después de correr la suite completa.
- [x] **5.3 limpieza**: `dbg.test.ts`, `src/dbg.test.ts`, `src/server/dbg2.test.ts` y
      `v.mts.run` eliminados (git `D`). Suite: 86 ficheros / 676 tests, exit 0.

### Notas honestas (no bloquean la tarea)
- El `.settings/recon.json` REAL del usuario sigue con el valor corrupto heredado
  (`nuclei → /tmp/dbg2-…/slow.sh`) de ANTES del aislamiento. Los tests ya no lo tocan, pero
  ese binPath apunta a una ruta inexistente: conviene re-poner la ruta de nuclei en Ajustes
  (o limpiar el fichero). No lo toco sin permiso (es config real gitignored).
- `process.chdir` no se restaura en `afterAll` y deja un tmpdir `recon-settings-` sin limpiar:
  inocuo (suite verde), pero mejorable.
- Queda 1 warning de ESLint PRE-EXISTENTE (`eslint-disable no-var` redundante en
  `recon-runner.ts`), ajeno a esta tarea: cleanup trivial de un carácter.

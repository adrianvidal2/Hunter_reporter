# Tarea 2 — Pipeline determinista

## Objetivo
Encadenar las herramientas de recon automáticamente, con forma según el scope
(wildcard / host concreto / mixto). El humano aprueba el plan antes de lanzar; el gate corta
antes de lo agresivo. **Sin LLM.**

## Forma del pipeline
- Wildcard (`*.x.com`): enumerar (subfinder/dnsx) → httpx → crawl (katana/gospider) → gf → activo.
- Host concreto (sin wildcard): se salta la enumeración → httpx → crawl → gf → activo.
- Mixto: unión; enumerar solo las ramas wildcard.
- Antes de las etapas activo/explotación: parar y pedir confirmación (gate).

## Ficheros a tocar / crear
- `src/core/recon/flows.ts` — parsers de aristas (URLs de katana/gospider/gau para gf), junto a
  `parseHttpxHosts`.
- `src/core/recon/pipeline.ts` (NUEVO, PURO) — `planPipeline(scope)` → plan de etapas editable.
- `src/server/recon-pipeline.ts` (NUEVO) — orquestador: recorre el plan, llama
  `getReconRunner().start()` por etapa, espera, extrae salida, escribe el `targets.txt` de la
  siguiente.
- `src/components/recon-panel.tsx` — pantalla "Plan": etapas propuestas, toggles, targets,
  "Lanzar pipeline".

## Reutilizar
- `getTool`, `RECON_TOOLS`, `resolveTargets`, `needsGate`, `normalizeTarget`, `baseDomain`
  (`src/core/recon/tools.ts`).
- `getReconRunner`, `ReconRunRecord`, el SSE y `run.json` del runner (`src/server/recon-runner.ts`).
- `parseHttpxHosts` + `extractReconItems` (`flows.ts` / `diff.ts`).

## Tests en profundidad
- **`pipeline.test.ts` (puro)**:
  - scope solo wildcard → incluye etapa de enumeración.
  - scope solo host concreto → NO incluye enumeración, arranca en httpx.
  - scope mixto → enumera solo las ramas wildcard.
  - scope vacío → plan vacío / error claro.
  - solo URLs en scope → ruta correcta hacia sqlmap/dalfox.
- **Parsers de aristas**: URLs válidas, líneas basura y flags disfrazados (`-oN`) fuera,
  únicas y en orden; vacío → `[]`.
- **Orquestador** (`spawnImpl`/runner inyectado, patrón `recon-runner.test.ts`):
  - secuencia: la salida de la etapa N llena el `targets.txt` de N+1.
  - gate: para antes de activo sin `confirmed`; con `confirmed` sigue.
  - una etapa sin resultados → el pipeline para con mensaje, no arrastra vacío a la siguiente.
  - fallo/timeout de una etapa → el pipeline no continúa a ciegas.
  - cancelar a mitad → no arranca etapas posteriores.
  - targets siempre interseccionados con el scope (nada fuera de scope puede colarse).

## Validación (comprobada 2026-10-14)
- [x] Suite completa verde: **84 ficheros, 639 tests**, exit 0 (el EPIPE que dejaba exit≠0
      quedó arreglado en `recon-runner.ts` como parte de esta tarea — ver 5.1).
- [x] Tests nuevos cubren el spec: forma del plan (wildcard/concreto/mixto/URLs/vacío/inválido),
      gate, intersección por host, fallo, timeout, cancelación, validación de etapas vs plan
      del servidor (`pipeline.test.ts`, `recon-pipeline.test.ts`).
- [x] `npx tsc --noEmit` sin errores.
- [x] ESLint: **0 errores** en los ficheros de la tarea. 1 warning PRE-EXISTENTE
      (`eslint-disable no-var` redundante en `recon-runner.ts`, ya en HEAD) — no introducido
      aquí; cleanup trivial para el track de higiene.
- [x] Nada fuera de lista blanca: el orquestador no spawnea ni construye comandos; el runner
      sigue dueño de recetas + gate; la intersección por host es doble (orquestador + runner).
- [ ] **Manual pendiente** `pnpm dev`: ver el plan para un scope wildcard y uno concreto,
      editarlo, lanzarlo y comprobar que el gate corta antes de nuclei. (Verificado por
      lectura + tests; no ejecutado en navegador.)

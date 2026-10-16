# Tarea 7a — Recolección de JS + reconstrucción de sourcemaps

Parte de la [Tarea 7](07-auditoria-js.md). Base del epic; determinista, testeable con fixtures.

## Objetivo
Reunir los JS en scope y, donde haya `.map`, **reconstruir las fuentes originales** (100%
fiable cuando el map existe). Reportar **cobertura honesta** (qué JS, cuáles con map).

## Alcance / decisiones
- Fuente de JS: reutilizar lo que el recon ya captura (katana/gau) y/o un **fetch ligero**
  (GET de estáticos, tier "light" como katana — no es activo/exploit, sin gate).
- Reconstrucción: detectar `//# sourceMappingURL=` / `.js.map`, parsear el sourcemap
  (`sources` + `sourcesContent`) y volcar las fuentes. Es la especificación → exacto.
- **Sin inventar**: si no hay map, NO se intenta "des-minificar" semánticamente aquí (eso es
  hipótesis del LLM/agente en 07d/07e). Solo se marca el hueco.

## Ficheros (propuesta)
- `src/core/recon/js-recon.ts` (núcleo puro): parseo de sourcemap → ficheros reconstruidos;
  detección de `sourceMappingURL`.
- `src/server/js-harvest.ts`: recolección/fetch ligero + persistencia bajo
  `<proyecto>/pentest/recon/js/<fecha>/` (coherente con el resto de recon) + `coverage.json`.

## Tests en profundidad
- Sourcemap sintético (sources + sourcesContent) → fuentes reconstruidas byte a byte.
- `.map` ausente / `sourceMappingURL` ausente → hueco marcado, sin crash.
- Sourcemap malformado → se ignora sin romper; cobertura lo refleja.
- JS enorme / rutas raras en `sources` → no escribe fuera del dir de salida (resolveSafe*).

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **91 ficheros, 737 tests** (+18 de 7a), exit 0; `tsc`/`eslint` limpios.
- [x] Núcleo (`js-recon.ts`): `parseSourcemap` tolerante; `resolveSourceMapping` (remota/inline
      base64/última-manda/`//@` legado/ninguna→null); `reconstructFromSourcemap` **byte a byte**
      donde hay `sourcesContent`, hueco donde no, malformado→null sin crash; `safeSourceFileName`
      aplana y neutraliza traversal/unidades Windows/esquemas; `summarizeCoverage` honesto.
- [x] Harvest (`js-harvest.ts`, fetch inyectado → **sin tráfico real**): inline y remota
      reconstruyen byte a byte; no-map/map-invalid/map-without-content/fetch-error/skipped-large
      marcados; `coverage.json` generado; **intersección de scope** (nada fuera se descarga).
- [x] Contención: toda escritura por `resolveSafe*`; una source que resuelva fuera del root se
      salta y queda como hueco (doble defensa con `safeSourceFileName`). Fetch = tier light, sin gate.
- [x] Núcleo + server con fetch inyectable → no toca datos reales; no hay paso manual pendiente.

### Nota
Es el **motor** de recolección/reconstrucción; aún sin consumidor/disparador en la UI (lo
consumen 7b/7c y un lanzador posterior). Probarlo contra un objetivo real ya sería tráfico (tier light).

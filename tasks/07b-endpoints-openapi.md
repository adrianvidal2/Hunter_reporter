# Tarea 7b — Endpoints/params → OpenAPI

Parte de la [Tarea 7](07-auditoria-js.md). Depende de **07a**.

## Objetivo
Extraer endpoints y parámetros de los JS (y de las fuentes reconstruidas en 07a) y construir
un **OpenAPI** del scope, **marcando los huecos** (lo que no se pudo resolver).

## Alcance / decisiones
- Determinista: patrones para literales (`fetch("/api/x")`, axios/XHR, rutas string,
  plantillas de ruta). **Alta precisión en literales.**
- Lo dinámico (`base + "/" + id`, construido al vuelo, ofuscado) **NO se adivina**: se
  registra como hueco con el fragmento de origen, para que el agente (07e) lo ataque.
- Salida: documento OpenAPI (métodos/paths/params detectados) + `gaps.json`.

## Ficheros (propuesta)
- `src/core/recon/js-endpoints.ts` (puro): extracción + build del OpenAPI + lista de huecos.
- Enganche en `src/server/js-harvest.ts` (consume la salida de 07a).

## Tests en profundidad
- JS con endpoints literales variados → OpenAPI con esos paths/métodos.
- Llamadas dinámicas → van a `gaps`, no al OpenAPI (sin inventar).
- Dedup de endpoints repetidos; params de query/body detectados donde sea literal.
- Ruido (strings que parecen rutas pero no lo son) → precisión razonable, documentada.

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **92 ficheros, 747 tests** (+10 de 7b), exit 0; `tsc`/`eslint` limpios.
- [x] `extractEndpoints` ALTA PRECISIÓN en literales: fetch (+method/body), axios
      nombrado/plano/objeto, XHR `.open`, URL absoluta→path; query dedup y `from` unido entre
      ficheros. `STR` con grupos nombrados (backrefs no se rompen al incrustar).
- [x] **Lo dinámico NO se inventa**: `${}`→`dynamic-template`, concatenación→`concatenation`,
      relativa sin base→`relative-no-base`; van a `gaps` con su fragmento (para el agente en 7e).
- [x] `buildOpenApi` honesto: `x-recon` + descripción "reconstruido, sin verificar"; modelo
      vacío → paths vacíos (sin inventar).
- [x] Enganche en `js-harvest.ts`: genera `openapi.json` + `gaps.json` sobre las fuentes
      reconstruidas de 7a (relevo A).
- [x] Núcleo + harvest con fetch inyectable → no toca datos reales; sin paso manual pendiente.

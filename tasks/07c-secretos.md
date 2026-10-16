# Tarea 7c — Secretos accionables en JS

Parte de la [Tarea 7](07-auditoria-js.md). Depende de **07a**.

## Objetivo
Detectar secretos en los JS/fuentes **que sean accionables y reportables** — no ruido (p. ej.
NO Google Maps API keys), como pide el prompt real.

## Alcance / decisiones
- Determinista: reglas regex de patrones conocidos (AWS keys, tokens tipo JWT, claves
  privadas, bearer, URLs con credenciales…), con **entropía** como señal auxiliar.
- Filtro de ruido explícito: lista de patrones no accionables (Maps/analytics/claves públicas
  conocidas) que se marcan como "probable ruido".
- La decisión final "accionable sí/no" la afina el validador LLM en 07d; aquí se da la señal.

## Ficheros (propuesta)
- `src/core/recon/js-secrets.ts` (puro): reglas + entropía + clasificación ruido/candidato.

## Tests en profundidad
- Fixtures con secretos reales-sintéticos (AWS/JWT/clave privada) → detectados.
- Google Maps key / clave pública conocida → marcada como ruido, no como hallazgo.
- Falsos positivos de alta entropía (hashes, ids) → no inflan la lista (umbral + contexto).
- Sin secretos → `[]` sin romper.

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **93 ficheros, 760 tests** (+13 de 7c), exit 0; `tsc`/`eslint` limpios.
- [x] Formatos conocidos → `candidato`: AWS key, AWS secret, GitHub PAT, Slack, Stripe live,
      JWT, clave privada embebida, bearer, URL con credenciales.
- [x] **Ruido explícito** (lo que el prompt pide NO reportar): Google `AIza…`, reCAPTCHA site
      key → `probable-ruido`, **nunca** `candidato`.
- [x] Genérico clave:valor: entropía (Shannon) + placeholder + contexto-de-ruido deciden
      candidato/ruido. Hash de alta entropía **sin** contexto de secreto → no infla la lista.
- [x] Dedup por valor con `occurrences`; prioridad formato>genérico (JWT en var `token` → jwt,
      no duplicado); sin secretos / no-string → `[]` defensivo; tope de hallazgos.
- [x] Enganche en `js-harvest.ts`: `secrets.json` (candidatos vs ruido). Núcleo puro + harvest
      con fetch inyectable → sin datos reales; sin paso manual pendiente.

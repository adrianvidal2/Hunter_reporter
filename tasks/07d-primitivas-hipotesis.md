# Tarea 7d — Primitivas + hipótesis (validador LLM)

Parte de la [Tarea 7](07-auditoria-js.md). Depende de **07a-c** + **6a** (KB).

## Objetivo
Sobre la salida determinista (endpoints/OpenAPI de 07b, secretos de 07c, fuentes de 07a),
un **validador LLM** deriva **primitivas** (bloques accionables: endpoint+param candidato a
SQLi, sink reflejado/postMessage, secreto usable, ruta sensible) e **hipótesis rankeadas**,
etiquetadas como **leads best-effort** (nunca hechos). Se guardan como **KB de proyecto**.

## Alcance / decisiones
- **Determinista primero**: lo que ya es señal clara (p. ej. endpoint con `id` numérico →
  candidato BOLA/SQLi) se marca sin gastar LLM; el LLM entra en lo difuso/priorización.
- **Anti-inyección OBLIGATORIO**: el contenido JS viene del objetivo → DATO; reusar el patrón
  de `core/recon/classify.ts` / `core/llm/prompt.ts` (`escapeTag` + nonce). Registrar la
  pasada en `llm_runs`.
- Salida: primitivas + hipótesis con probabilidad/razón; **nunca** confirma explotabilidad.
- Persistencia: escribir las primitivas como entradas KB de proyecto (6a `createKb`,
  categoría `tecnica`) → reutilizables y recuperables (6e).

## Ficheros (propuesta)
- `src/core/recon/primitives.ts` (puro): pre-filtro determinista + ensamblado del prompt.
- `src/server/derive-primitives.ts`: orquesta LLM (chatCompletion) + persiste a KB.

## Tests en profundidad
- Pre-filtro determinista detecta candidatos obvios sin llamar al LLM.
- Anti-inyección: contenido JS adversario (delimitadores + órdenes) no rompe el bloque.
- Salida basura del LLM → degradación segura (nada se marca como confirmado).
- Persistencia: las primitivas se guardan como KB de proyecto y se recuperan.
- Registro en `llm_runs` solo si hubo llamada.

## Validación (comprobada 2026-10-16)
- [x] Suite completa verde: **95 ficheros, 775 tests** (+15 de 7d), exit 0; `tsc`/`eslint` limpios.
- [x] **Determinista primero** (`deriveDeterministicPrimitives`, sin LLM): id-shape→bola-idor+sqli,
      auth/upload/admin→sus primitivas, secretos SOLO si `candidato` (el ruido de 7c no entra), dedup.
- [x] **Anti-inyección** (`buildPrimitivesPrompt`): una sola apertura real con nonce, cierre único,
      contenido del objetivo escapado como DATO; el system prohíbe confirmar.
- [x] **LLM = leads, nunca confirma**: `parseHypotheses` basura/fence/no-array → `[]`, kind
      normalizado, probabilidad acotada. Nada se marca como hecho.
- [x] Orquestador (`derive-primitives.ts`): sin settings → solo deterministas en KB, 0 llamadas,
      sin `llm_runs`; con settings → hipótesis persistidas + fila en `llm_runs`; salida basura o
      fallo 401 → **degradación segura** (deterministas intactas); sin artifacts → error claro;
      **cap** de entradas KB; artifacts corruptos tolerados.
- [x] Persistencia: primitivas + hipótesis como **KB de proyecto** (`tecnica`, tags `lead`), con
      el cuerpo declarando "lead best-effort, SIN confirmar". Fetch inyectable → sin datos reales.
- [x] Núcleo + server con fetch inyectable → sin paso manual pendiente.

# Tarea 7 (epic) — Auditoría guiada por reconstrucción de JS

Epic partido en mini-tareas (`07a`–`07e`). Nace del prompt real que el usuario manda a los
agentes: reconstruir JS (sourcemaps), sacar endpoints→OpenAPI y secretos, derivar primitivas
e hipótesis, y de ahí auditar (SQLi, lógica…).

## Idea y principio rector
**Combinar por RELEVO (handoff), no en paralelo:**
- **A (reporter, determinista)** saca la parte **fiable** (sourcemaps presentes, endpoints/
  secretos literales) **y marca los huecos** (dinámicos, sin map).
- **B (agente Orca, lanzado por el humano)** recibe A como punto de partida y **ataca los
  huecos** + lo activo (probar SQLi, lógica, DOM con playwright, registrar cuenta…).
- Lo que B descubre **vuelve a la KB** (primitivas acumuladas) → feedback loop.

## Verdades que NO se negocian
- **Nadie reconstruye el 100%.** A es fiable donde el dato existe (sourcemap → desempaquetado
  exacto; literales → alta precisión); lo demás es best-effort.
- **Transparencia de cobertura**: siempre se reporta qué se sacó y qué no (los huecos son
  dónde el agente gana su sueldo).
- **LLM/agente = leads, no hechos.** La salida son hipótesis a verificar.
- **Activo = humano.** Reconstruir/razonar es gratis; lanzar pruebas contra el objetivo (SQLi,
  cuentas, DOM) lo dispara el humano vía agente/gate.
- **Anti-inyección** en todo nodo LLM (contenido JS = NO confiable): patrón `escapeTag`+nonce
  de `core/llm/prompt.ts`.

## Reutilizar
Recon pipeline (JS ya recolectado por katana/gau), KB de 6a/6b (guardar primitivas),
`applyKbToPrompt`/`launch.ts` de 6c (semilla de misión), triaje/anti-inyección de la tarea 4.

## Orden y dependencias
1. **07a** — Recolección JS + reconstrucción de sourcemaps (base, determinista).
2. **07b** — Endpoints/params → OpenAPI (dep. 07a).
3. **07c** — Secretos accionables (dep. 07a).
4. **07d** — Primitivas + hipótesis: validador LLM sobre 07a-c → KB de proyecto (dep. 07a-c + 6a).
5. **07e** — Semilla de misión + handoff al agente (dep. 07b-d + 6c).

Lo activo (explotación) = el agente Orca que ya existe, lanzado por el humano.

## Fase futura
Feedback loop agente→KB (que lo hallado por B enriquezca el almacén de primitivas);
indexar las primitivas en el FTS5 de 6e para recuperación.

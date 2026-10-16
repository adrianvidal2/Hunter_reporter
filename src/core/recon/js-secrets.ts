/**
 * Secretos accionables en JS (Tarea 7c). Núcleo PURO: reglas regex de
 * formatos conocidos + entropía como señal auxiliar + filtros de ruido.
 *
 * Filosofía (epic 7): aquí solo se da la SEÑAL determinista. La decisión
 * final "accionable sí/no" la afina el validador LLM (07d); lo que sale de
 * aquí es: 'candidato' (formato conocido o alta entropía con contexto de
 * secreto) o 'probable-ruido' (claves públicas de cliente, placeholders,
 * baja entropía) — marcado, nunca descartado.
 *
 * Ruido explícito (lo que el prompt real pide NO reportar): Google Maps /
 * API keys de cliente (AIza…), site keys de reCAPTCHA, analytics.
 */

export type SecretConfidence = 'candidato' | 'probable-ruido'

export interface SecretFinding {
  /** Identificador de la regla que detectó el hallazgo. */
  kind: string
  /** El valor sospechoso (recortado a 200 chars). */
  value: string
  confidence: SecretConfidence
  /** Qué es según la regla (para la UI y el validador LLM). */
  description: string
  /** Contexto ±60 chars alrededor del match (para 07d). */
  context: string
  /** Veces que aparece el mismo valor en el texto. */
  occurrences: number
}

/** Entropía de Shannon (bits por carácter): señal auxiliar anti-falso-positivo. */
export function shannonEntropy(s: string): number {
  if (s === '') return 0
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let h = 0
  for (const count of freq.values()) {
    const p = count / s.length
    h -= p * Math.log2(p)
  }
  return h
}

/** Umbral de entropía para el genérico clave:valor (12345678 = 3.0 exacto). */
const ENTROPY_THRESHOLD = 3.0
/** Tope de hallazgos por texto (evita explosiones en bundles gigantes). */
const MAX_FINDINGS = 200
/** Tope de longitud del valor mostrado. */
const MAX_VALUE_LEN = 200

interface SecretRule {
  id: string
  description: string
  pattern: RegExp
  confidence: SecretConfidence
  /** Grupo con el valor (0 = match completo). */
  valueGroup?: number
}

/**
 * Reglas de FORMATO CONOCIDO: si casan, el formato ya es la señal.
 * (Valores sintéticos en tests; aquí solo patrones.)
 */
const KNOWN_RULES: SecretRule[] = [
  { id: 'aws-access-key', description: 'Access key de AWS (AKIA…)', pattern: /\bAKIA[0-9A-Z]{16}\b/, confidence: 'candidato' },
  { id: 'aws-secret', description: 'Secret key de AWS junto a su contexto', pattern: /\baws(?:.{0,30}?)["']([0-9a-zA-Z/+]{40})["']/i, valueGroup: 1, confidence: 'candidato' },
  { id: 'github-pat', description: 'Personal access token de GitHub (ghp_…)', pattern: /\bghp_[A-Za-z0-9]{36}\b/, confidence: 'candidato' },
  { id: 'slack-token', description: 'Token de Slack (xox…)', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, confidence: 'candidato' },
  { id: 'stripe-live', description: 'Clave live de Stripe (sk_live_…)', pattern: /\bsk_live_[0-9a-zA-Z]{16,}\b/, confidence: 'candidato' },
  { id: 'jwt', description: 'JWT (tres segmentos base64url)', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, confidence: 'candidato' },
  { id: 'private-key', description: 'Clave PRIVADA embebida en el JS', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, confidence: 'candidato' },
  { id: 'bearer-literal', description: 'Bearer token embebido', pattern: /\bBearer\s+[A-Za-z0-9_\-~=+/]{20,}/, confidence: 'candidato' },
  { id: 'url-credentials', description: 'URL con credenciales (user:pass@host)', pattern: /\bhttps?:\/\/[^\s:/@]+:[^@\s/]{3,}@[^\s/"']/, confidence: 'candidato' },
]

/**
 * Reglas de RUIDO EXPLÍCITO: claves PÚBLICAS de cliente y similares que el
 * prompt real pide NO reportar como hallazgo. Se listan como
 * 'probable-ruido' (transparencia: están, pero no molan).
 */
const NOISE_RULES: SecretRule[] = [
  { id: 'google-api-key', description: 'API key de cliente de Google (Maps/etc.): pública por diseño, no accionable', pattern: /\bAIza[0-9A-Za-z_\-]{35}\b/, confidence: 'probable-ruido' },
  { id: 'recaptcha-site-key', description: 'Site key de reCAPTCHA: pública por diseño, no accionable', pattern: /\b6L[A-Za-z0-9_\-]{38}\b/, confidence: 'probable-ruido' },
]

/** Palabras clave que dan contexto de secreto al genérico clave:valor.
 *  El keyword puede ser SUFIJO camelCase de un identificador
 *  (googleAnalyticsToken, myApiKey…) — por eso no hay \b delante. */
const GENERIC_KEY_RE =
  /([A-Za-z0-9_-]*(?:api[_-]?key|apikey|secret|token|auth[_-]?token|access[_-]?token|password|passwd|pwd|credentials?))[ \t]*[:=][ \t]*(["'])([^"'\s]{8,200})\2/gi

/** Aspectos de placeholder/basura que degradan un match genérico. */
const PLACEHOLDER_RE = /(?:your|ejemplo|example|sample|changeme|cambia|xxxx+|<[^>]*>|\$\{|placeholder|null|undefined|dummy|test[-_]?key)/i

/**
 * Escanea un texto buscando secretos. Sin secretos → []. Dedup por
 * (kind+valor); el mismo valor encontrado por varias reglas se queda la
 * de mayor prioridad (formato conocido > genérico). Tope: 200 hallazgos.
 */
export function scanSecrets(text: string): SecretFinding[] {
  if (typeof text !== 'string' || text === '') return []
  const byValue = new Map<string, SecretFinding>()

  const add = (finding: SecretFinding, priority: number): void => {
    const value = finding.value.slice(0, MAX_VALUE_LEN)
    const existing = byValue.get(value)
    if (existing) {
      existing.occurrences++
      // prioridad 1 (formato conocido) gana sobre 2 (genérico/ruido)
      if (priority < 2) {
        byValue.set(value, { ...finding, value, occurrences: existing.occurrences })
      }
      return
    }
    const idx = text.indexOf(value)
    byValue.set(value, {
      ...finding,
      value,
      occurrences: 1,
      context: idx >= 0 ? text.slice(Math.max(0, idx - 60), idx + value.length + 60) : '',
    })
  }

  // 1) formatos conocidos → candidatos
  for (const rule of KNOWN_RULES) {
    for (const m of text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g'))) {
      const value = (m[rule.valueGroup ?? 0] ?? m[0]).slice(0, MAX_VALUE_LEN)
      add(
        { kind: rule.id, value, confidence: 'candidato', description: rule.description, context: '', occurrences: 0 },
        1,
      )
      if (byValue.size >= MAX_FINDINGS) return [...byValue.values()]
    }
  }

  // 2) ruido explícito (claves públicas de cliente)
  for (const rule of NOISE_RULES) {
    for (const m of text.matchAll(new RegExp(rule.pattern.source, 'g'))) {
      const value = m[0].slice(0, MAX_VALUE_LEN)
      add(
        { kind: rule.id, value, confidence: 'probable-ruido', description: rule.description, context: '', occurrences: 0 },
        1,
      )
    }
  }

  // 3) genérico clave:valor — la entropía y el aspecto deciden
  for (const m of text.matchAll(GENERIC_KEY_RE)) {
    const value = m[3]!.slice(0, MAX_VALUE_LEN)
    if (byValue.has(value)) continue // ya detectado por una regla de formato
    const lowEntropy = shannonEntropy(value) <= ENTROPY_THRESHOLD
    const placeholder = PLACEHOLDER_RE.test(value)
    const contextKey = m[1]!.toLowerCase()
    const noiseContext = /(?:maps|analytics|recaptcha|ga-|google)/i.test(contextKey)
    add(
      {
        kind: 'generic-secret',
        value,
        confidence: lowEntropy || placeholder || noiseContext ? 'probable-ruido' : 'candidato',
        description: `Asignación con palabra de secreto («${m[1]}») y entropía ${shannonEntropy(value).toFixed(2)}`,
        context: '',
        occurrences: 0,
      },
      2,
    )
    if (byValue.size >= MAX_FINDINGS) break
  }

  return [...byValue.values()].slice(0, MAX_FINDINGS)
}

import { createHash } from 'node:crypto'

/**
 * Análisis determinista de una propuesta de reescritura (8.4/8.7).
 *
 * Todo lo que el LLM NO debe tocar (código, URLs, números) se compara aquí
 * con técnicas exactas (hash/regex/conjuntos), sin LLM en el camino.
 *
 * Normalización de bloques de código (checkpoint 8.0, matiz 1 del usuario):
 * SOLO se recortan espacios/saltos de BORDE. Los espacios interiores y la
 * indentación se conservan tal cual: en un payload son significativos.
 * Preferimos un falso "modificado" a un falso "idéntico".
 */

export interface CodeBlock {
  /** Origen: 'original' | 'proposal'. */
  from: 'original' | 'proposal'
  /** Índice secuencial dentro de su documento (0-based). */
  index: number
  /** Lenguaje declarado en el fence, si lo hay. */
  lang: string | null
  /** Contenido crudo del bloque (entre fences). */
  raw: string
  /** Contenido normalizado (trim de bordes) — base del hash. */
  normalized: string
  hash: string
}

/** Normalización de bloque (matiz 1 del checkpoint): SOLO bordes.
 *  - espacios/tabs AL FINAL de cada línea: se quitan (ruido de copy-paste)
 *  - líneas vacías al inicio/final del bloque: se quitan
 *  - espacios AL PRINCIPIO de línea (indentación): se CONSERVAN — en un
 *    payload son significativos. Un bloque indentado vs sin indentar =
 *    MODIFICADO: preferimos falso "modificado" a falso "idéntico". */
function normalizeBlock(raw: string): string {
  const lines = raw.replace(/[ \t]+(?=\n|$)/g, '').split('\n')
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

/** Extrae bloques ``` y ~~~ con sus metadatos. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const out: CodeBlock[] = []
  const lines = markdown.split('\n')
  let inBlock = false
  let lang: string | null = null
  let buf: string[] = []
  let fence = ''
  let index = 0

  for (const line of lines) {
    const m = /^(```+|~~~+)\s*([\w+-]*)\s*$/.exec(line)
    if (!inBlock && m) {
      inBlock = true
      fence = m[1]!
      lang = m[2] || null
      buf = []
    } else if (inBlock && (line.startsWith(fence) && line.trim() === fence.slice(0, 3))) {
      const raw = buf.join('\n')
      const normalized = normalizeBlock(raw) // SOLO bordes: indentación intacta
      out.push({
        from: 'original', // el llamador sobrescribe según proceda
        index: index++,
        lang,
        raw,
        normalized,
        hash: createHash('sha256').update(normalized).digest('hex'),
      })
      inBlock = false
      lang = null
    } else if (inBlock) {
      buf.push(line)
    }
  }
  return out
}

// ─── URLs ────────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

export function extractUrls(markdown: string): string[] {
  return [...new Set((markdown.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))]
}

// ─── Valores literales ───────────────────────────────────────────────────

export interface LiteralValues {
  cvss: string[]
  httpStatus: string[]
  ports: string[]
  /** IDs tipo #YWH-PGM40972-5, CVE-2021-44228… */
  identifiers: string[]
}

const LITERAL_PATTERNS: { key: keyof LiteralValues; re: RegExp }[] = [
  { key: 'cvss', re: /(?:CVSS[:\s v3./]*)(\d+(?:\.\d+)?)\s*(?=[),。\n\r\s]|$)/gi },
  { key: 'httpStatus', re: /\b(?:HTTP|status|Status|STATUS)[\s/]*(\d{3})\b/g },
  { key: 'ports', re: /\b(?:port|puerto)[:\s]*(\d{2,5})\b/gi },
  { key: 'identifiers', re: /#?((?:YWH|CVE|CWE|GHSA)[-A-Z0-9]*-\d+(?:-\d+)?)\b/g },
]

export function extractLiterals(markdown: string): LiteralValues {
  const out: LiteralValues = { cvss: [], httpStatus: [], ports: [], identifiers: [] }
  for (const { key, re } of LITERAL_PATTERNS) {
    const found = new Set<string>()
    // identificadores: captura completa; el resto: grupo 1
    for (const m of markdown.matchAll(re)) {
      found.add(key === 'identifiers' ? (m[1] ?? '') : (m[1] ?? m[0]))
    }
    out[key] = [...found].filter(Boolean).sort()
  }
  return out
}

// ─── Secciones ───────────────────────────────────────────────────────────

export interface Section {
  level: number
  title: string
}

export function extractSections(markdown: string): Section[] {
  return markdown
    .split('\n')
    .filter((l) => /^#{1,3}\s+/.test(l))
    .map((l) => ({
      level: (l.match(/^#+/) ?? ['#'])[0]!.length,
      title: l.replace(/^#{1,3}\s+/, '').trim(),
    }))
}

// ─── Comparación ─────────────────────────────────────────────────────────

export type BlockStatus = 'identical' | 'modified' | 'lost' | 'added'

export interface BlockComparison {
  originalIndex: number | null
  proposalIndex: number | null
  lang: string | null
  preview: string
  status: BlockStatus
}

export interface LiteralsComparison {
  key: keyof LiteralValues
  /** Valores del original que NO están en la propuesta. */
  missing: string[]
  /** Valores nuevos que no estaban en el original (posible alucinación). */
  added: string[]
}

export interface SectionComparison {
  original: string
  proposal: string | null
  /** Bloques/URLs del original presentes en la sección y su cobertura. */
  blockCoverage: string // "2/2" o "sin datos"
  urlCoverage: string
}

export interface ReviewAnalysis {
  blocks: BlockComparison[]
  urls: { missing: string[]; added: string[] }
  literals: LiteralsComparison[]
  /** Cobertura de secciones del original (título ↔ propuesta). */
  sections: SectionComparison[]
  /** Secciones de la PLANTILLA que faltan en la propuesta. */
  missingTemplateSections: string[]
  /** true si hay algún perdido (bloque/URL/valor/sección). */
  hasLoss: boolean
}

const cover = (original: number, found: number) =>
  original === 0 ? 'sin datos' : `${found}/${original}`

export function analyzeRewrite(
  original: string,
  proposal: string,
  template: string,
): ReviewAnalysis {
  // Bloques
  const origBlocks = extractCodeBlocks(original).map((b) => ({ ...b, from: 'original' as const }))
  const propBlocks = extractCodeBlocks(proposal).map((b) => ({ ...b, from: 'proposal' as const }))
  const propHashes = new Map<string, number>()
  propBlocks.forEach((b, i) => {
    if (!propHashes.has(b.hash)) propHashes.set(b.hash, i)
  })
  const usedProp = new Set<number>()

  const blocks: BlockComparison[] = origBlocks.map((b) => {
    const exact = propHashes.get(b.hash)
    if (exact !== undefined) {
      usedProp.add(exact)
      return {
        originalIndex: b.index,
        proposalIndex: exact,
        lang: b.lang,
        preview: b.normalized.split('\n')[0] ?? '',
        status: 'identical',
      }
    }
    // modificado o perdido: ¿queda al menos un bloque con el mismo lenguaje?
    const sameLang = propBlocks.findIndex((p, i) => !usedProp.has(i) && p.lang === b.lang)
    if (sameLang !== -1) {
      usedProp.add(sameLang)
      return {
        originalIndex: b.index,
        proposalIndex: sameLang,
        lang: b.lang,
        preview: b.normalized.split('\n')[0] ?? '',
        status: 'modified',
      }
    }
    return {
      originalIndex: b.index,
      proposalIndex: null,
      lang: b.lang,
      preview: b.normalized.split('\n')[0] ?? '',
      status: 'lost',
    }
  })
  for (let i = 0; i < propBlocks.length; i++) {
    if (!usedProp.has(i)) {
      blocks.push({
        originalIndex: null,
        proposalIndex: i,
        lang: propBlocks[i]!.lang,
        preview: propBlocks[i]!.normalized.split('\n')[0] ?? '',
        status: 'added',
      })
    }
  }

  // URLs
  const origUrls = new Set(extractUrls(original))
  const propUrls = new Set(extractUrls(proposal))
  const urls = {
    missing: [...origUrls].filter((u) => !propUrls.has(u)),
    added: [...propUrls].filter((u) => !origUrls.has(u)),
  }

  // Literales
  const oLit = extractLiterals(original)
  const pLit = extractLiterals(proposal)
  const literals: LiteralsComparison[] = (['cvss', 'httpStatus', 'ports', 'identifiers'] as const).map(
    (key) => {
      const o = new Set(oLit[key])
      const p = new Set(pLit[key])
      return {
        key,
        missing: [...o].filter((v) => !p.has(v)),
        added: [...p].filter((v) => !o.has(v)),
      }
    },
  )

  // Secciones del original ↔ propuesta (cobertura de bloques/URLs internos)
  const slice = (md: string, titles: string[]): string => {
    const lines = md.split('\n')
    let acc = ''
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.replace(/^#{1,3}\s+/, '').trim()
      if (titles.includes(t)) {
        const level = (lines[i]!.match(/^#+/) ?? ['#'])[0]!.length
        let end = lines.length
        for (let j = i + 1; j < lines.length; j++) {
          const mHashes = lines[j]!.match(/^#+\s/)
          if (mHashes && mHashes[0]!.trim().length <= level) {
            end = j
            break
          }
        }
        acc += lines.slice(i, end).join('\n') + '\n'
        i = end - 1
      }
    }
    return acc
  }
  const sectionSpanCovered = (titleA: string, titlesB: string[]) => {
    const orig = slice(original, [titleA])
    const prop = slice(proposal, titlesB)
    const nBlocks = extractCodeBlocks(orig).length
    const oHashes = new Set(extractCodeBlocks(orig).map((b) => b.hash))
    const found = extractCodeBlocks(prop).filter((b) => oHashes.has(b.hash)).length
    const nUrls = extractUrls(orig).length
    const oUrls = new Set(extractUrls(orig))
    const foundUrls = extractUrls(prop).filter((u) => oUrls.has(u)).length
    return { blocks: cover(nBlocks, found), urls: cover(nUrls, foundUrls) }
  }

  const oSections = extractSections(original)
  const pSections = extractSections(proposal)
  const sections: SectionComparison[] = oSections.map((s) => {
    // título en propuesta: igual, o traducción aproximada ignorando caja
    const norm = (t: string) => t.toLowerCase().replace(/[^a-záéíóúñ0-9 ]/g, '').trim()
    const candidates = pSections
      .filter((p) => p.level === s.level)
      .map((p) => p.title)
      .filter((t) => {
        const nt = norm(t)
        const ns = norm(s.title)
        return nt === ns || nt.includes(ns.split(' ')[0]!) || ns.includes(nt.split(' ')[0]!)
      })
    const covered = sectionSpanCovered(s.title, candidates)
    return {
      original: s.title,
      proposal: candidates[0] ?? null,
      blockCoverage: covered.blocks,
      urlCoverage: covered.urls,
    }
  })

  // Secciones de la plantilla que faltan (encabezados sin placeholder)
  const templateTitles = template
    .split('\n')
    .filter((l) => /^#{1,3}\s+/.test(l) && !l.includes('{{'))
    .map((l) => l.replace(/^#{1,3}\s+/, '').trim())
    .filter((t) => !t.match(/^(Finding \d|$)/))
  const pTitles = new Set(pSections.map((s) => s.title.toLowerCase()))
  const missingTemplateSections = templateTitles.filter((t) => {
    const base = t.replace(/ —.*$/, '').toLowerCase()
    return ![...pTitles].some((pt) => pt === base || pt.startsWith(base))
  })

  const hasLoss =
    blocks.some((b) => b.status === 'lost') ||
    urls.missing.length > 0 ||
    literals.some((l) => l.missing.length > 0)

  return { blocks, urls, literals, sections, missingTemplateSections, hasLoss }
}

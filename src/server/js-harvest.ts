import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '@/lib/env'
import { writeAtomic } from '@/core/fs/atomic'
import { resolveSafeAllowMissing } from '@/core/fs/paths'
import { sanitizeFilename } from '@/core/fs/sanitize'
import { intersectWithScope } from '@/core/recon/pipeline'
import { buildOpenApi, extractEndpoints, type JsSourceText } from '@/core/recon/js-endpoints'
import { scanSecrets } from '@/core/recon/js-secrets'
import {
  MAX_JS_BYTES,
  MAX_MAP_BYTES,
  reconstructFromSourcemap,
  resolveSourceMapping,
  summarizeCoverage,
  type JsCoverageEntry,
} from '@/core/recon/js-recon'

/**
 * Harvest de JS (Tarea 7a): GET ligero de los JS en scope (mismo tier que
 * katana/httpx: estáticos, SIN gate — no es activo ni explotación) y
 * reconstrucción de fuentes donde hay sourcemap. Persistencia coherente
 * con el árbol de recon: `<proyecto>/pentest/recon/js/<fecha>/` con
 * `coverage.json` (transparencia: qué se sacó y qué no).
 *
 * - Los URLs los trae el recon (katana/gau) o el usuario; el SERVIDOR los
 *   interseca contra el scope (nada fuera de scope se descarga).
 * - Sin map NO se inventa nada: hueco marcado en la cobertura.
 * - Toda escritura pasa por resolveSafe* (contención en el dir de salida),
 *   con nombres aplanados por el núcleo (safeSourceFileName).
 */

const STAMP = (d = new Date()): string =>
  d.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')

export interface HarvestJsInput {
  project: string
  /** URLs de JS a recolectar (el servidor filtra por scope). */
  urls: string[]
  /** Scope in-scope ACTUAL del programa.json (lo trae el llamador). */
  scope: string[]
  userAgent?: string
  timeoutMs?: number
  /** Para tests: fetch inyectable. */
  fetchImpl?: typeof fetch
  root?: string
}

export interface HarvestJsResult {
  ok: boolean
  error?: string
  /** Dir de salida relativo a REPORTS_ROOT. */
  outputDir?: string
  coverage?: JsCoverageEntry[]
  stats?: ReturnType<typeof summarizeCoverage>
  /** API extraída de los JS/fuentes (openapi.json + gaps.json). */
  api?: { endpoints: number; gaps: number }
  /** Secretos detectados (secrets.json): candidatos vs probable ruido. */
  secrets?: { candidates: number; noise: number }
}

/** GET ligero: sin redirect ilimitados, con timeout; devuelve texto o error. */
async function fetchText(
  url: string,
  opts: { userAgent?: string; timeoutMs?: number; fetchImpl: typeof fetch },
): Promise<{ ok: true; body: string } | { ok: false; error: string; status?: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000)
  try {
    const res = await opts.fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: opts.userAgent ? { 'user-agent': opts.userAgent } : {},
    })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, status: res.status }
    }
    const body = await res.text()
    return { ok: true, body }
  } catch (err) {
    clearTimeout(timer)
    return { ok: false, error: err instanceof Error ? err.message : 'Error de red' }
  } finally {
    clearTimeout(timer)
  }
}

/** Nombre de fichero seguro para el JS descargado, derivado de su URL. */
function jsFileNameFromUrl(url: string, index: number): string {
  try {
    const parsed = new URL(url)
    const base = sanitizeFilename(path.basename(parsed.pathname) || 'index.js')
    return `${index}-${base.toLowerCase().replace(/\.md$/i, '.js')}`
  } catch {
    return `${index}-index.js`
  }
}

/**
 * Recolecta los JS marcados, reconstruye fuentes donde hay sourcemap y
 * escribe todo (JS, maps, src/, coverage.json) bajo
 * `<proyecto>/pentest/recon/js/<fecha>/`. Sin lanzar procesos: SOLO fetch
 * ligero de estáticos + escrituras contenidas.
 */
export async function harvestJs(input: HarvestJsInput): Promise<HarvestJsResult> {
  const root = input.root ?? getEnv().REPORTS_ROOT
  const fetchImpl = input.fetchImpl ?? fetch
  const fetchOpts = { userAgent: input.userAgent, timeoutMs: input.timeoutMs, fetchImpl }

  // Intersección servidor-side contra el scope: nada fuera se descarga.
  const inScope = intersectWithScope(input.urls, input.scope)
  const outOfScope = input.urls.filter((u) => !inScope.includes(u))

  const stamp = STAMP()
  const outRel = `${input.project}/pentest/recon/js/${stamp}`
  try {
    const outAbs = resolveSafeAllowMissing(outRel, root)
    mkdirSync(path.join(outAbs, 'js'), { recursive: true })
    mkdirSync(path.join(outAbs, 'maps'), { recursive: true })
    mkdirSync(path.join(outAbs, 'src'), { recursive: true })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Ruta de salida inválida' }
  }

  const coverage: JsCoverageEntry[] = outOfScope.map((url) => ({ url, status: 'out-of-scope' }))
  /** Textos para el extractor de endpoints (07b): fuentes reconstruidas si
   *  hay map; el JS crudo si no (los minificados también tienen literales). */
  const apiSources: JsSourceText[] = []
  let serverUrl: string | undefined

  for (let i = 0; i < inScope.length; i++) {
    const url = inScope[i]!
    const jsName = jsFileNameFromUrl(url, i)

    // 1) GET del JS (light, con tope de tamaño)
    const jsRes = await fetchText(url, fetchOpts)
    if (!jsRes.ok) {
      coverage.push({ url, status: 'fetch-error', error: jsRes.error })
      continue
    }
    if (jsRes.body.length > MAX_JS_BYTES) {
      coverage.push({ url, status: 'skipped-large', jsBytes: jsRes.body.length, error: 'JS supera el tope de lectura' })
      continue
    }
    const jsRel = `${outRel}/js/${jsName}`
    writeAtomic(jsRel, jsRes.body, { root })
    const entry: JsCoverageEntry = { url, status: 'no-map', jsBytes: jsRes.body.length }
    try {
      serverUrl ??= new URL(url).origin
    } catch {
      /* URL rara: sin server en el OpenAPI */
    }
    // el crudo aporta literales salvo que la reconstrucción lo sustituya
    apiSources.push({ name: url, content: jsRes.body })

    // 2) ¿Hay sourcemap? (inline o remota → un GET más)
    let mapRaw: string | null = null
    let mapUrl: string | undefined
    const mapping = resolveSourceMapping(url, jsRes.body)
    if (mapping?.kind === 'inline') {
      mapRaw = mapping.json
    } else if (mapping?.kind === 'remote') {
      mapUrl = mapping.url
      const mapRes = await fetchText(mapping.url, fetchOpts)
      if (!mapRes.ok) {
        coverage.push({ ...entry, status: 'map-fetch-error', mapUrl, error: mapRes.error })
        continue
      }
      if (mapRes.body.length > MAX_MAP_BYTES) {
        coverage.push({ ...entry, status: 'map-fetch-error', mapUrl, error: 'map supera el tope de lectura' })
        continue
      }
      mapRaw = mapRes.body
      writeAtomic(`${outRel}/maps/${jsName}.map`, mapRaw, { root })
    } else {
      coverage.push(entry)
      continue
    }

    // 3) Reconstrucción EXACTA desde el map
    const rec = reconstructFromSourcemap(mapRaw ?? '')
    if (!rec) {
      coverage.push({ ...entry, status: 'map-invalid', mapUrl })
      continue
    }

    // 4) Volcado contenido: cada fuente por resolveSafe* (contención dura)
    const srcDirRel = `${outRel}/src/${i}`
    let filesWritten = 0
    const usedNames = new Set<string>()
    for (const file of rec.files) {
      if (file.content === null) continue // hueco: sin sourcesContent no se inventa
      let name = file.fileName
      let n = 2
      while (usedNames.has(name)) name = `${file.fileName}-${n++}`
      usedNames.add(name)
      try {
        const absTarget = resolveSafeAllowMissing(`${srcDirRel}/${name}`, root) // contención: fuera → excepción
        mkdirSync(path.dirname(absTarget), { recursive: true }) // writeAtomic exige el padre
        writeAtomic(`${srcDirRel}/${name}`, file.content, { root })
        filesWritten++
      } catch (err) {
        // ruta que se resuelve FUERA del root: se salta y queda como hueco
        coverage.push({
          ...entry,
          status: 'map-without-content',
          mapUrl,
          sources: rec.files.length,
          reconstructed: rec.withContent,
          error: `source no contenida, ignorada: ${file.sourcePath} (${err instanceof Error ? err.message : 'error'})`,
        })
        filesWritten = -1 // marca de que ya se registró la cobertura de esta URL
        break
      }
    }
    if (filesWritten < 0) continue

    coverage.push({
      ...entry,
      status: rec.withoutContent === rec.files.length ? 'map-without-content' : 'reconstructed',
      mapUrl,
      sources: rec.files.length,
      reconstructed: rec.withContent,
      filesWritten,
    })

    // fuentes reconstruidas CON contenido: la mejor materia prima para 07b
    // (sustituyen al JS crudo: mismos literales, pero con nombres reales)
    const rawIdx = apiSources.findIndex((s) => s.name === url)
    if (rawIdx >= 0) apiSources.splice(rawIdx, 1)
    for (const file of rec.files) {
      if (file.content !== null) apiSources.push({ name: `${url} :: ${file.sourcePath}`, content: file.content })
    }
  }

  // ── 07b: endpoints → OpenAPI + gaps (lo dinámico no se adivina) ──
  const api = extractEndpoints(apiSources)
  const openapi = buildOpenApi(api, {
    title: `API reconstruida de ${input.project}`,
    serverUrl,
  })
  writeAtomic(`${outRel}/openapi.json`, JSON.stringify(openapi, null, 2) + '\n', { root })
  writeAtomic(
    `${outRel}/gaps.json`,
    JSON.stringify({ generatedAt: new Date().toISOString(), gaps: api.gaps }, null, 2) + '\n',
    { root },
  )

  // ── 07c: secretos accionables (candidatos) vs ruido (Maps/etc.) ──
  const secretFindings = apiSources.flatMap((s) =>
    scanSecrets(s.content).map((f) => ({ ...f, source: s.name })),
  )
  const secrets = {
    candidates: secretFindings.filter((f) => f.confidence === 'candidato').length,
    noise: secretFindings.filter((f) => f.confidence === 'probable-ruido').length,
  }
  writeAtomic(
    `${outRel}/secrets.json`,
    JSON.stringify({ generatedAt: new Date().toISOString(), stats: secrets, findings: secretFindings }, null, 2) + '\n',
    { root },
  )

  const stats = summarizeCoverage(coverage)
  // coverage.json: transparencia total (los huecos son dónde gana el agente)
  writeAtomic(
    `${outRel}/coverage.json`,
    JSON.stringify({ generatedAt: new Date().toISOString(), project: input.project, stats, coverage }, null, 2) + '\n',
    { root },
  )

  return {
    ok: true,
    outputDir: outRel,
    coverage,
    stats,
    api: { endpoints: api.endpoints.length, gaps: api.gaps.length },
    secrets,
  }
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  getReconBinStatusAction,
  getReconContextAction,
  getReconOutputAction,
  getLiveHostsAction,
  startReconAction,
  startUrlReconAction,
  listReconRunsAction,
  cancelReconAction,
  killOrphanAction,
  type ReconContext,
} from '@/app/escaneos/recon-actions'
import type { ReconRunRecord } from '@/server/recon-runner'
import Link from 'next/link'
import { RECON_TOOLS } from '@/core/recon/tools'

/**
 * Subpestana Recon (pestaña Escaneos del proyecto): las herramientas en
 * tres niveles de riesgo VISUALES (pasivas / tráfico ligero / escaneo
 * activo) más una sección aparte para sqlmap/dalfox (URL concreta).
 *
 * - Los targets SOLO salen del programa.json (checkboxes); sin texto libre.
 * - ffuf/gobuster: hosts vivos del último httpx como preferentes; fzzeear
 *   el apex exige confirmación explícita (aviso).
 * - Escaneo activo y explotación: gate — la app pide confirmación salvo
 *   que las reglas autoricen explícitamente la automatización.
 */

const GROUPS: { title: string; tone: string; ids: string[] }[] = [
  { title: 'Pasivas (sin tráfico al target)', tone: 'text-zinc-600 dark:text-zinc-300', ids: ['subfinder', 'gau', 'waybackurls', 'gf'] },
  { title: 'Tráfico ligero (UA del programa + rate conservador)', tone: 'text-amber-600 dark:text-amber-400', ids: ['httpx', 'dnsx', 'katana', 'gospider', 'waymore'] },
  { title: 'Escaneo activo (pide confirmación salvo autorización explícita)', tone: 'text-red-600 dark:text-red-400', ids: ['nmap', 'ffuf', 'gobuster', 'nuclei'] },
]

const FUZZERS = new Set(['ffuf', 'gobuster'])

function toolDef(id: string) {
  return RECON_TOOLS.find((t) => t.id === id)!
}

export function ReconPanel({ project }: { project: string }) {
  const [context, setContext] = useState<ReconContext | null>(null)
  const [binOk, setBinOk] = useState<Map<string, boolean> | null>(null)
  const [ctxError, setCtxError] = useState<string | null>(null)
  const [selectedTool, setSelectedTool] = useState<string | null>(null)
  const [targets, setTargets] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [runs, setRuns] = useState<ReconRunRecord[]>([])
  const [liveHosts, setLiveHosts] = useState<string[] | null>(null)
  const [fuzzTargets, setFuzzTargets] = useState<Set<string>>(new Set())
  const [apexAccepted, setApexAccepted] = useState(false)
  const [viewOutput, setViewOutput] = useState<{ key: string; text: string } | null>(null)

  // sqlmap/dalfox
  const [urlTool, setUrlTool] = useState<'sqlmap' | 'dalfox'>('sqlmap')
  const [urlTarget, setUrlTarget] = useState('')
  const [urlPath, setUrlPath] = useState('')

  const refreshRuns = useCallback(() => {
    void listReconRunsAction(project).then(setRuns)
  }, [project])

  useEffect(() => {
    void getReconContextAction(project).then((ctx) => {
      if (ctx.ok) {
        setContext(ctx)
        setTargets(new Set())
      } else {
        setCtxError(ctx.error ?? 'Error')
      }
      refreshRuns()
    })
    void getLiveHostsAction(project).then((r) => setLiveHosts(r.ok ? (r.hosts ?? []) : null))
    void getReconBinStatusAction().then((status) => {
      setBinOk(new Map(status.map((s) => [s.toolId, s.ok])))
    })
  }, [project, refreshRuns])

  const scopeTargets = context?.targets ?? []
  const apexOfWildcard = scopeTargets.filter((t) => t.startsWith('*.')).map((t) => t.replace(/^\*\./, ''))
  const isFuzzer = selectedTool !== null && FUZZERS.has(selectedTool)

  const toggle = (set: Set<string>, apply: (s: Set<string>) => void, t: string) => {
    const next = new Set(set)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    apply(next)
  }

  const launch = () => {
    if (!selectedTool) return
    setBusy(true)
    setNote(null)
    // fuzzers: SIEMPRE los hosts vivos marcados; el apex solo si aceptaste el aviso
    const finalTargets = isFuzzer ? [...fuzzTargets] : [...targets]
    if (isFuzzer && apexAccepted) {
      for (const t of targets) if (!finalTargets.includes(t)) finalTargets.push(t)
    }
    void startReconAction({ project, toolId: selectedTool, targets: finalTargets, confirmed }).then((res) => {
      setBusy(false)
      if (res.ok) {
        setNote({ ok: true, msg: `Lanzado (${res.runId})${res.warnings.length > 0 ? ` · ⚠ ${res.warnings.join(' · ')}` : ''}` })
        setConfirmed(false)
        refreshRuns()
      } else if (res.needsConfirmation) {
        setNote({ ok: false, msg: `⛔ ${res.error} — ${res.verdictReason ?? ''}`.trim() })
      } else {
        setNote({ ok: false, msg: `✗ ${res.error}` })
      }
    })
  }

  const launchUrl = () => {
    setBusy(true)
    setNote(null)
    void startUrlReconAction({ project, toolId: urlTool, urlTarget, urlPath, confirmed }).then((res) => {
      setBusy(false)
      if (res.ok) {
        setNote({ ok: true, msg: `Lanzado (${res.runId})` })
        refreshRuns()
      } else if (res.needsConfirmation) {
        setNote({ ok: false, msg: `⛔ ${res.error} — ${res.verdictReason ?? ''}`.trim() })
      } else {
        setNote({ ok: false, msg: `✗ ${res.error}` })
      }
    })
  }

  /** Toggle: si está abierto el MISMO run, colapsa; si no, carga su salida. */
  const showOutput = (run: ReconRunRecord) => {
    if (viewOutput?.key === run.runId) {
      setViewOutput(null)
      return
    }
    setViewOutput({ key: run.runId, text: '' })
    void getReconOutputAction(project, run.toolId, run.dirName).then((r) => {
      // solo si sigue abierto este run (evita pisar otro que se abrió después)
      setViewOutput((prev) => (prev?.key === run.runId ? { key: run.runId, text: r.output ?? r.error ?? '' } : prev))
    })
  }

  if (ctxError) {
    return (
      <div className="mt-4 max-w-xl rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        {ctxError} — la pestaña Programa del proyecto puede rellenarlo.
      </div>
    )
  }
  if (!context) {
    return <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Cargando contexto del programa…</p>
  }

  /** binario no disponible (no existe o no ejecutable) → herramienta deshabilitada */
  const binMissing = (toolId: string): boolean => binOk?.get(toolId) === false
  const binReason = (label: string): string =>
    `binario no encontrado: instala ${label} o configura su ruta en Ajustes`

  const targetList = scopeTargets

  return (
    <div className="mt-4 space-y-6">
      {/* Selección de targets del scope */}
      <section aria-label="Targets del scope">
        <h3 className="text-sm font-semibold">Targets del scope (programa.json)</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Solo aparecen los dominios in-scope del programa. Nada fuera de esta lista puede acabar en un comando.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {targetList.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">El programa no declara scope.</p>
          ) : (
            targetList.map((t) => (
              <label key={t} className="flex items-center gap-1.5 rounded-md border border-zinc-300 px-2 py-1 font-mono text-xs dark:border-zinc-700">
                <input
                  type="checkbox"
                  checked={targets.has(t)}
                  onChange={() => toggle(targets, setTargets, t)}
                />
                {t}
              </label>
            ))
          )}
        </div>
      </section>

      {note ? (
        <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {note.msg}
        </p>
      ) : null}

      {/* Grupos por riesgo */}
      {GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title} className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className={`text-sm font-semibold ${group.tone}`}>{group.title}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {group.ids.map((id) => {
              const def = toolDef(id)
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selectedTool === id}
                  aria-disabled={binMissing(id)}
                  disabled={binMissing(id)}
                  onClick={() => setSelectedTool(id)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    binMissing(id)
                      ? 'cursor-not-allowed border-zinc-200 text-zinc-300 opacity-50 dark:border-zinc-800 dark:text-zinc-600'
                      : selectedTool === id
                        ? 'border-zinc-900 bg-zinc-900 font-medium text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900'
                  }`}
                  title={binMissing(id) ? binReason(def.label) : def.rateLimitNote}
                >
                  {def.label}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {binOk !== null && [...binOk.entries()].some(([id, ok]) => !ok && RECON_TOOLS.some((t) => t.id === id)) ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Herramientas en gris: falta el binario (indicador ❌). Instálalas o configura su ruta en{' '}
          <Link href="/ajustes" className="underline">Ajustes → Recon</Link>.
        </p>
      ) : null}

      {/* Opciones de la herramienta seleccionada */}
      {selectedTool ? (
        <section aria-label={`Opciones de ${selectedTool}`} className="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="text-sm font-semibold">Lanzar {selectedTool}</h3>
          {isFuzzer ? (
            <div className="mt-2 space-y-2 text-sm">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Los fuzzers van sobre HOSTS VIVOS concretos (salida del último httpx), no sobre el dominio del scope.
              </p>
              {liveHosts && liveHosts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {liveHosts.map((h) => (
                    <label key={h} className="flex items-center gap-1.5 rounded-md border border-zinc-300 px-2 py-1 font-mono text-xs dark:border-zinc-700">
                      <input type="checkbox" checked={fuzzTargets.has(h)} onChange={() => toggle(fuzzTargets, setFuzzTargets, h)} />
                      {h}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No hay hosts vivos todavía: lanza httpx primero y vuelve aquí.
                </p>
              )}
              {apexOfWildcard.length > 0 ? (
                <label className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <input type="checkbox" checked={apexAccepted} onChange={(e) => setApexAccepted(e.target.checked)} />
                  ÚLTIMO RECURSO: fzzeear también el apex ({apexOfWildcard.join(', ')}) del wildcard — probablemente el
                  contenido está en subdominios vivos. Se registrará el aviso en run.json.
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={launch}
              disabled={busy || (selectedTool !== null && binMissing(selectedTool))}
              title={
                selectedTool !== null && binMissing(selectedTool)
                  ? binReason(toolDef(selectedTool).label)
                  : undefined
              }
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {busy ? 'Lanzando…' : 'Lanzar'}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Confirmo haber leído las reglas del programa (exigido si prohíben/no mencionan automatización)
            </label>
          </div>
        </section>
      ) : null}

      {/* sqlmap/dalfox: URL concreta, trato aparte */}
      <section aria-label="Explotación sobre URL concreta" className="rounded-md border border-red-300 p-4 dark:border-red-800">
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
          Explotación — sobre UNA URL concreta (no sobre el scope)
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <select value={urlTool} onChange={(e) => setUrlTool(e.target.value as 'sqlmap' | 'dalfox')} aria-label="Herramienta de explotación" className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]">
            <option value="sqlmap" disabled={binMissing('sqlmap')}>sqlmap (NO destructivo: detección){binMissing('sqlmap') ? ' — binario no encontrado' : ''}</option>
            <option value="dalfox" disabled={binMissing('dalfox')}>dalfox (XSS){binMissing('dalfox') ? ' — binario no encontrado' : ''}</option>
          </select>
          <select value={urlTarget} onChange={(e) => setUrlTarget(e.target.value)} aria-label="Target del scope para la URL" className="max-w-72 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:[color-scheme:dark]">
            <option value="">— target del scope…</option>
            {scopeTargets.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            type="text"
            value={urlPath}
            onChange={(e) => setUrlPath(e.target.value)}
            placeholder="/ruta opcional o ?query=1"
            aria-label="Ruta opcional"
            className="w-56 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 font-mono text-xs dark:border-zinc-700"
          />
          <button
            type="button"
            onClick={launchUrl}
            disabled={busy || urlTarget === '' || binMissing(urlTool)}
            title={binMissing(urlTool) ? binReason(toolDef(urlTool).label) : undefined}
            className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
          >
            {busy ? 'Lanzando…' : 'Lanzar contra esta URL'}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          sqlmap arranca en modo NO destructivo (level/risk 1, 1 thread, sin --dump ni segundo orden): subirlas exige receta
          revisada en código. Aplican las mismas reglas de confirmación.
        </p>
      </section>

      {/* Histórico de runs */}
      <section aria-label="Histórico de runs">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Runs</h3>
          <button type="button" onClick={refreshRuns} className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
            Actualizar
          </button>
        </div>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Sin runs todavía.</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {runs.map((r) => (
              <li key={r.runId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 font-mono text-xs">
                  {r.toolId} · {r.startedAt.replace('T', ' ').slice(0, 19)} ·{' '}
                  <span className={r.status === 'running' ? 'text-sky-600' : r.status === 'done' ? 'text-emerald-600' : 'text-zinc-500'}>
                    {r.status}
                  </span>
                  {r.confirmedByUser ? ' · confirmado por ti' : ''}
                  {r.warnings.length > 0 ? ` · ⚠ ${r.warnings.length} aviso(s)` : ''}
                </span>
                <span className="flex shrink-0 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => showOutput(r)}
                    aria-expanded={viewOutput?.key === r.runId}
                    className="rounded-md border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    {viewOutput?.key === r.runId ? 'Ocultar salida' : 'Ver salida'}
                  </button>
                  {r.status === 'running' ? (
                    <button type="button" onClick={() => void cancelReconAction(r.runId).then(refreshRuns)} className="rounded-md border border-red-300 px-2 py-0.5 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">
                      Cancelar
                    </button>
                  ) : null}
                  {r.status === 'orphaned' ? (
                    <button type="button" onClick={() => void killOrphanAction(project, r.toolId, r.dirName).then(refreshRuns)} className="rounded-md border border-red-300 px-2 py-0.5 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950" title="pid vivo de una sesión anterior: matarlo explícitamente">
                      Matar huérfano
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {viewOutput ? (
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-xs text-zinc-100">
            {viewOutput.text || (viewOutput.text === '' ? 'Cargando…' : '(sin salida)')}
          </pre>
        ) : null}
      </section>
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { generateRewriteAction, acceptRewriteAction } from '@/app/pendientes/actions'
import { discardPendingAction } from '@/app/actions'
import type { ReviewAnalysis } from '@/core/reports/review'
import type { TemplateOption } from '@/core/reports/templates'
import type { GenerateResult } from '@/server/generate-rewrite'
import { MarkdownPreview } from './markdown-preview'

/**
 * Vista de revisión de la propuesta (8.4): evidencia determinista en tablas
 * (bloques/URLs/valores/secciones) + diff crudo plegado + previews.
 * Aceptar/Descartar llegan en 8.5/8.6; aquí se GENERA y se revisa.
 */

const STATUS_LABEL: Record<string, string> = {
  identical: '✅ idéntico',
  modified: '⚠️ modificado',
  lost: '❌ perdido',
  added: '＋ añadido',
}

const LITERAL_LABEL: Record<string, string> = {
  cvss: 'CVSS',
  httpStatus: 'Estados HTTP',
  ports: 'Puertos',
  identifiers: 'IDs (YWH/CVE/CWE)',
}

function countBlocks(a: ReviewAnalysis) {
  const by = (s: string) => a.blocks.filter((b) => b.status === s).length
  return { identical: by('identical'), modified: by('modified'), lost: by('lost'), added: by('added') }
}

function trafficLight(n: number | undefined, total: number) {
  if (n === undefined || total === 0) return <span className="text-zinc-400">sin datos</span>
  if (n === total) return <span className="text-emerald-600 dark:text-emerald-400">{n}/{total} ✅</span>
  if (n === 0) return <span className="text-red-600 dark:text-red-400">{n}/{total} ❌</span>
  return <span className="text-amber-600 dark:text-amber-400">{n}/{total} ⚠️</span>
}

function countLost(a: ReviewAnalysis): number {
  return (
    a.blocks.filter((b) => b.status === 'lost').length +
    a.urls.missing.length +
    a.literals.reduce((n, l) => n + l.missing.length, 0)
  )
}

export function RewriteReview({
  path,
  templates,
  preselectedTemplate,
  generate: generateProposal = generateRewriteAction,
}: {
  path: string
  /** Selector de plantilla (10.1): sin él, usa el default (flujo Pendientes). */
  templates?: TemplateOption[]
  preselectedTemplate?: string
  /** Acción de generación (default: Pendientes; 10.1 pasa la de borradores). */
  generate?: (path: string, templateName?: string) => Promise<GenerateResult>
}) {
  const [templateName, setTemplateName] = useState<string | undefined>(preselectedTemplate)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<ReviewAnalysis | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRawDiff, setShowRawDiff] = useState(false)
  const [ackLosses, setAckLosses] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const generate = () =>
    startTransition(async () => {
      setError(null)
      setMarkdown(null)
      setAnalysis(null)
      const res = await generateProposal(path, templateName)
      if (!res.ok) {
        setError(res.error ?? 'Error inesperado')
        return
      }
      setMarkdown(res.markdown!)
      setAnalysis(res.analysis!)
      setInfo(`${res.info?.model ?? '?'} · ${res.info?.attempts ?? 1} intento(s) · ${res.info?.latencyMs ?? 0} ms · plantilla ${res.templateUsed?.name ?? '—'}`)
    })

  const accept = () =>
    startTransition(async () => {
      setError(null)
      const res = await acceptRewriteAction(path, markdown!)
      if (!res.ok) {
        setError(res.error ?? 'Error')
        return
      }
      setDone(`✅ Guardado. Original archivado en ${res.archivedTo ?? '.history/'}`)
      setMarkdown(null)
      setAnalysis(null)
    })

  const discard = () =>
    startTransition(async () => {
      setError(null)
      const res = await discardPendingAction(path)
      if (!res.ok) {
        setError(res.error ?? 'Error')
        return
      }
      setDone('🗑️ Descartado: el fichero original no se ha tocado (byte a byte idéntico).')
      setMarkdown(null)
      setAnalysis(null)
    })

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {templates && templates.length > 0 ? (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Plantilla
            <select
              value={templateName ?? ''}
              onChange={(e) => setTemplateName(e.target.value)}
              aria-label="Plantilla para la reescritura"
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:[color-scheme:dark]"
            >
              {templates.map((t) => (
                <option key={`${t.scope}:${t.name}`} value={t.name}>
                  {t.name}
                  {t.scope === 'project' ? ' · proyecto' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {pending ? 'Generando propuesta…' : 'Generar propuesta de reescritura'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

          {done ? (
            <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {done}
            </p>
          ) : markdown && analysis ? (
        <div className="mt-4 space-y-5">
          {/* 1. Cabecera de semáforos */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <span>
              Bloques{' '}
              {trafficLight(countBlocks(analysis).identical, analysis.blocks.filter((b) => b.originalIndex !== null).length)}
            </span>
            <span>
              URLs{' '}
              {trafficLight(
                analysis.urls.missing.length === 0 ? undefined : 0,
                analysis.urls.missing.length,
              )}
              {analysis.urls.missing.length === 0 && (
                <span className={analysis.urls.added.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                  {' '}
                  sin pérdidas{analysis.urls.added.length ? ` · ${analysis.urls.added.length} añadidas ⚠️` : ''}
                </span>
              )}
            </span>
            {analysis.literals.map((l) => (
              <span key={l.key}>
                {LITERAL_LABEL[l.key]}{' '}
                {l.missing.length === 0 && l.added.length === 0 ? (
                  <span className="text-zinc-400">
                    {l.missing.length === 0 && l.added.length === 0 ? 'sin datos' : ''}
                  </span>
                ) : (
                  <span className={l.missing.length ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}>
                    {l.missing.length ? `${l.missing.length} perdidos` : ''}
                    {l.missing.length && l.added.length ? ' · ' : ''}
                    {l.added.length ? `${l.added.length} nuevos` : ''}
                  </span>
                )}
              </span>
            ))}
          </div>

          {/* 2. Tabla de bloques de código */}
          <section aria-label="Bloques de código">
            <h3 className="text-sm font-semibold">Bloques de código</h3>
            {analysis.blocks.length === 0 ? (
              <p className="text-xs text-zinc-400">sin datos</p>
            ) : (
              <table className="mt-2 w-full text-left text-sm">
                <thead className="text-xs text-zinc-500 dark:text-zinc-400">
                  <tr>
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">Leng</th>
                    <th className="py-1 pr-3">Primera línea</th>
                    <th className="py-1">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {analysis.blocks.map((b, i) => (
                    <tr key={`${b.originalIndex}-${b.proposalIndex}-${i}`}>
                      <td className="py-1 pr-3 tabular-nums">{b.originalIndex !== null ? b.originalIndex + 1 : '—'}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{b.lang ?? ''}</td>
                      <td className="max-w-0 truncate py-1 pr-3 font-mono text-xs">{b.preview || '(vacío)'}</td>
                      <td
                        className={`py-1 ${
                          b.status === 'identical'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : b.status === 'lost'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {STATUS_LABEL[b.status]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* 3. URLs y 4. valores literales (solo si hay algo que decir) */}
          {(analysis.urls.missing.length > 0 || analysis.urls.added.length > 0) && (
            <section aria-label="URLs">
              <h3 className="text-sm font-semibold">URLs</h3>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {analysis.urls.missing.map((u) => (
                  <li key={u} className="text-red-600 dark:text-red-400">− {u}</li>
                ))}
                {analysis.urls.added.map((u) => (
                  <li key={u} className="text-amber-600 dark:text-amber-400">＋ {u}</li>
                ))}
              </ul>
            </section>
          )}

          {analysis.literals.some((l) => l.missing.length || l.added.length) && (
            <section aria-label="Valores literales">
              <h3 className="text-sm font-semibold">Valores literales</h3>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {analysis.literals.map((l) => (
                  <li key={l.key}>
                    <span className="text-zinc-500 dark:text-zinc-400">{LITERAL_LABEL[l.key]}:</span>{' '}
                    {l.missing.map((v) => (
                      <span key={`${l.key}-m-${v}`} className="text-red-600 dark:text-red-400">−{v} </span>
                    ))}
                    {l.added.map((v) => (
                      <span key={`${l.key}-a-${v}`} className="text-amber-600 dark:text-amber-400">＋{v} </span>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 5. Mapa de estructura */}
          <section aria-label="Estructura">
            <h3 className="text-sm font-semibold">Estructura (original → propuesta)</h3>
            <table className="mt-2 w-full text-left text-sm">
              <thead className="text-xs text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1 pr-3">Original</th>
                  <th className="py-1 pr-3">Propuesta</th>
                  <th className="py-1 pr-3">Bloques</th>
                  <th className="py-1">URLs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {analysis.sections.map((s) => (
                  <tr key={s.original}>
                    <td className="py-1 pr-3">{s.original}</td>
                    <td className={`py-1 pr-3 ${s.proposal ? '' : 'text-red-600 dark:text-red-400'}`}>
                      {s.proposal ?? '(sin equivalente)'}
                    </td>
                    <td className={`py-1 pr-3 tabular-nums ${s.blockCoverage === 'sin datos' ? 'text-zinc-400' : ''}`}>
                      {s.blockCoverage}
                    </td>
                    <td className={`py-1 tabular-nums ${s.urlCoverage === 'sin datos' ? 'text-zinc-400' : ''}`}>
                      {s.urlCoverage}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analysis.missingTemplateSections.length > 0 ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Secciones de la plantilla ausentes: {analysis.missingTemplateSections.join(', ')}
              </p>
            ) : null}
          </section>

          {/* 6. Previews y diff plegado */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <details className="markdown-preview-frame rounded-md border border-zinc-300 dark:border-zinc-700">
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Propuesta (markdown crudo)</summary>
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap px-4 pb-4 font-mono text-xs">{markdown}</pre>
            </details>
            <div className="markdown-preview-frame max-h-[60vh] overflow-auto rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
              <MarkdownPreview markdown={markdown} />
            </div>
          </div>

          <details className="rounded-md border border-zinc-300 dark:border-zinc-700">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
              Diff crudo (útil en mismo idioma; la traducción lo marca todo)
            </summary>
            <p className="px-4 pb-3 text-xs text-zinc-400">
              Para traducciones usa las tablas de arriba: comparan lo que el LLM no debe tocar.
            </p>
          </details>

          {/* 7. Gate de fricción + acciones (checkpoint 8.0) */}
          {countLost(analysis) > 0 ? (
            <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <input
                type="checkbox"
                checked={ackLosses}
                onChange={(e) => setAckLosses(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Hay <strong>{countLost(analysis)}</strong> elemento(s) perdido(s) señalado(s) en rojo
                arriba. Marca esta casilla para habilitar Aceptar (decisión tuya, pero no
                accidental).
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={accept}
              disabled={pending || (countLost(analysis) > 0 && !ackLosses)}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {pending ? 'Guardando…' : 'Aceptar propuesta'}
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={pending}
              className="rounded-md border border-red-300 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
            >
              Descartar propuesta
            </button>
          </div>

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {info} · Aceptar guarda y archiva el original en .history/ · Descartar no toca el
            fichero.
          </p>
        </div>
      ) : null}
    </div>
  )
}

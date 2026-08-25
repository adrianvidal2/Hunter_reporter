'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saveFileAction } from '@/app/actions'
import { createAutosaveScheduler, type AutosaveScheduler } from '@/lib/autosave'
import { getMeta, updateMeta, type MetaField } from '@/core/reports/frontmatter'
import { CodeMirrorEditor } from './code-mirror-editor'
import { FrontMatterPanel } from './front-matter-panel'
import { MarkdownPreview } from './markdown-preview'

type Mode = 'editor' | 'split' | 'preview'

/**
 * Editor de borradores: CodeMirror + preview sanitizada (4.3/4.4),
 * vista dividida (4.5) y guardado con Ctrl+S vía writeAtomic (4.6).
 */
export default function MarkdownEditor({
  fileName,
  relPath,
  initialContent,
  initialMtimeMs,
}: {
  fileName: string
  /** Ruta relativa a REPORTS_ROOT (p. ej. demo_project/reportes/x.md). */
  relPath: string
  initialContent: string
  /** mtime (ms) del fichero al cargar la página: línea base del 4.7. */
  initialMtimeMs: number
}) {
  const [content, setContent] = useState(initialContent)
  const [savedContent, setSavedContent] = useState(initialContent)
  /** mtime que el editor considera vigente (al cargar o tras guardar). */
  const [baselineMtime, setBaselineMtime] = useState(initialMtimeMs)
  const [conflict, setConflict] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('split')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs espejo: el scheduler y el listener de teclado necesitan los valores
  // actuales sin re-registrarse en cada tecla.
  const contentRef = useRef(content)
  contentRef.current = content
  const mtimeRef = useRef(baselineMtime)
  mtimeRef.current = baselineMtime
  const savedContentRef = useRef(savedContent)
  savedContentRef.current = savedContent
  const conflictRef = useRef(conflict)
  conflictRef.current = conflict
  const savingRef = useRef(false)

  const dirty = content !== savedContent

  const save = useCallback(async () => {
    if (savingRef.current) return // no disparar en paralelo
    if (contentRef.current === savedContentRef.current) return // nada que guardar
    if (conflictRef.current) return // 4.7: requiere decisión del usuario
    savingRef.current = true
    setSaving(true)
    setError(null)
    setConflict(null)
    try {
      const res = await saveFileAction(relPath, contentRef.current, mtimeRef.current)
      if (res.ok) {
        setSavedContent(contentRef.current)
        if (res.mtimeMs !== undefined) setBaselineMtime(res.mtimeMs)
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1500)
      } else if (res.conflict) {
        setConflict(res.error ?? 'Conflicto de versión')
        schedulerRef.current?.cancel() // en conflicto no se reintenta solo
      } else {
        setError(res.error ?? 'Error inesperado')
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [relPath])

  // 4.9: autoguardado con debounce de 1,5 s — el scheduler se crea una vez
  const schedulerRef = useRef<AutosaveScheduler | null>(null)
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const scheduler = createAutosaveScheduler(() => {
      void saveRef.current()
    })
    schedulerRef.current = scheduler
    return () => scheduler.cancel()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault() // el navegador no debe abrir su diálogo de guardar
        if (!saving) void save()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [save, saving])

  // 4.10: metadatos derivados del documento (edición quirúrgica del YAML)
  const meta = useMemo(() => getMeta(content), [content])
  const setMeta = (field: MetaField, value: string) => {
    const next = updateMeta(content, { [field]: value })
    if (next !== content) {
      setContent(next)
      schedulerRef.current?.schedule()
    }
  }

  const modeButton = (value: Mode, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setMode(value)}
      aria-current={mode === value ? 'true' : undefined}
      className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
        mode === value
          ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900'
          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 truncate font-mono text-lg font-medium">{fileName}</h1>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-800">
            {modeButton('editor', 'Editor')}
            {modeButton('split', 'Dividido')}
            {modeButton('preview', 'Vista previa')}
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs">
        {dirty ? (
          <span className="text-amber-600 dark:text-amber-400">● sin guardar</span>
        ) : savedFlash ? (
          <span className="text-emerald-600 dark:text-emerald-400">Guardado ✓</span>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-500">Sin cambios</span>
        )}
        <span className="text-zinc-400 dark:text-zinc-500">
          <kbd className="rounded border border-zinc-300 px-1 font-mono dark:border-zinc-700">
            Ctrl+S
          </kbd>{' '}
          guarda · autoguardado a los 1,5 s
        </span>
        {error ? (
          <span role="alert" className="text-red-600 dark:text-red-400">
            {error}
          </span>
        ) : null}
      </div>

      {conflict ? (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        >
          <span>⚠️ {conflict}</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-md border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-600 dark:hover:bg-amber-900"
          >
            Recargar (descarta tus cambios)
          </button>
        </div>
      ) : null}

      <FrontMatterPanel values={meta} onChange={setMeta} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {mode !== 'preview' ? (
          <CodeMirrorEditor
            value={content}
            onChange={(next) => {
              setContent(next)
              schedulerRef.current?.schedule()
            }}
          />
        ) : null}
        {mode !== 'editor' ? (
          <div className="markdown-preview-frame max-h-[70vh] min-h-[60vh] overflow-auto rounded-md border border-zinc-300 p-6 dark:border-zinc-700">
            <MarkdownPreview markdown={content} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

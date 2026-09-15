'use client'

import { useRef, useState } from 'react'

/**
 * Zona de subida de PDFs entregados (REPORTES_YWH/): drag & drop + botón de
 * seleccionar ficheros. Los ficheros se suben UNO A UNO para dar progreso
 * por fichero; si uno falla, los demás siguen. El validado de verdad (magia
 * %PDF-, tamaño, colisión) lo hace el servidor: la UI solo informa.
 */

interface FileResult {
  original: string
  ok: boolean
  name?: string
  renamed?: boolean
  error?: string
}

interface PendingFile {
  original: string
  state: 'uploading' | 'done'
  result?: FileResult
}

const MAX_MB = 25

export function DeliverUploadZone({ project, onUploaded }: { project: string; onUploaded: () => void }) {
  const [dragOver, setDragOver] = useState(false)
  const [pending, setPending] = useState<PendingFile[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return
    setBusy(true)
    setPending(files.map((f) => ({ original: f.name, state: 'uploading' as const })))

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!
      const form = new FormData()
      form.append('files', file)
      let result: FileResult
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(project)}/deliver`, {
          method: 'POST',
          body: form,
        })
        const body = (await res.json()) as { results?: FileResult[]; error?: string }
        if (res.ok && body.results?.[0]) {
          result = body.results[0]!
        } else {
          result = { original: file.name, ok: false, error: body.error ?? `HTTP ${res.status}` }
        }
      } catch (err) {
        result = { original: file.name, ok: false, error: err instanceof Error ? err.message : 'Error de red' }
      }
      setPending((prev) => prev.map((p, j) => (j === i ? { ...p, state: 'done', result } : p)))
    }

    setBusy(false)
    onUploaded()
    // deja el informe visible unos segundos y limpia los OK (los fallos persisten)
    setTimeout(() => {
      setPending((prev) => prev.filter((p) => p.result && !p.result.ok))
    }, 6_000)
  }

  const zoneClass = `mt-4 rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
    dragOver
      ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
      : 'border-zinc-300 dark:border-zinc-700'
  }`

  return (
    <div
      className={zoneClass}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (!busy) void uploadFiles([...e.dataTransfer.files])
      }}
      aria-label="Zona para arrastrar PDFs"
    >
      <p className="text-zinc-500 dark:text-zinc-400">
        Arrastra aquí los PDFs entregados, o{' '}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="font-medium underline hover:text-zinc-900 disabled:opacity-40 dark:hover:text-zinc-100"
        >
          selecciona ficheros
        </button>
        .
      </p>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
        Solo PDF (se comprueba el contenido, no la extensión) · máximo {MAX_MB} MB por fichero · si
        ya existe uno con el mismo nombre, se guarda con sufijo (2).
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          void uploadFiles([...(e.target.files ?? [])])
          e.target.value = '' // permite re-seleccionar el mismo fichero
        }}
      />

      {pending.length > 0 ? (
        <ul className="mt-3 space-y-1 text-left" role="status">
          {pending.map((p) => {
            const r = p.result
            return (
              <li key={p.original} className="flex items-baseline justify-between gap-2 text-xs">
                {p.state === 'uploading' ? (
                  <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">
                    ⏳ Subiendo <span className="font-mono">{p.original}</span>…
                  </span>
                ) : r?.ok ? (
                  <span className="min-w-0 truncate text-emerald-600 dark:text-emerald-400">
                    ✓ <span className="font-mono">{r.name}</span>
                    {r.renamed ? ' — renombrado: ya existía uno con ese nombre' : ''}
                  </span>
                ) : (
                  <span className="min-w-0 truncate text-red-600 dark:text-red-400" role="alert">
                    ✗ <span className="font-mono">{p.original}</span>: {r?.error ?? 'Error'}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { discardPendingAction } from '@/app/actions'
import { RewriteReview } from './rewrite-review'
import { MarkdownPreview } from './markdown-preview'

/**
 * Panel de pendientes (paso 6.4): preview del markdown + decisión humana.
 * Reescribir = aprobar (6.5: atraviesa el guard; sin LLM aún, queda
 * registrada la aprobación). Descartar cierra el flujo para siempre.
 */

export interface PendingItem {
  path: string
  size: number
  detectedAtMs: number
  content: string | null
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

export function PendientesPanel({ items }: { items: PendingItem[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (items.length === 0) {
    return (
      <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
        Sin reportes pendientes de revisión.
      </p>
    )
  }

  const decide = (fn: () => Promise<{ ok: boolean; error?: string; note?: string }>) => {
    setError(null)
    setNote(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'Error inesperado')
      else if (res.note) setNote(res.note)
    })
  }

  return (
    <div>
      {note ? (
        <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          ℹ️ {note}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {items.map((item) => (
          <li key={item.path} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-sm">{item.path}</span>
              <span className="shrink-0 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                {formatBytes(item.size)} · {formatDate(item.detectedAtMs)}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {item.content !== null ? (
                <button
                  type="button"
                  onClick={() => setOpen(open === item.path ? null : item.path)}
                  aria-expanded={open === item.path}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  {open === item.path ? 'Ocultar preview' : 'Ver preview'}
                </button>
              ) : (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  (el fichero ya no está en disco)
                </span>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => decide(() => discardPendingAction(item.path))}
                className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
              >
                Descartar
              </button>
            </div>

            {open === item.path && item.content !== null ? (
              <div className="mt-3">
                <div className="markdown-preview-frame max-h-96 overflow-auto rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
                  <MarkdownPreview markdown={item.content} />
                </div>
                <RewriteReview path={item.path} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { deleteTemplateAction, saveTemplateAction } from '@/app/estructura-informe/actions'
import { MarkdownPreview } from './markdown-preview'

/**
 * Gestor de plantillas (paso 7.1): lista + editor + borrar.
 * Plantillas en .config/templates — el watcher las ignora, así que editarlas
 * no genera "pendientes".
 */

export interface TemplateItem {
  name: string
  content: string
}

export function TemplatesManager({ templates }: { templates: TemplateItem[] }) {
  const [selected, setSelected] = useState<string | null>(templates[0]?.name ?? null)
  const [name, setName] = useState('')
  const [content, setContent] = useState(templates[0]?.content ?? '')
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const pick = (t: TemplateItem) => {
    setSelected(t.name)
    setName(t.name.replace(/\.md$/i, ''))
    setContent(t.content)
    setFeedback(null)
  }

  const isNew = selected === null

  const save = () =>
    startTransition(async () => {
      const res = await saveTemplateAction(name, content)
      setFeedback(
        res.ok
          ? { ok: true, msg: `Guardado como ${res.savedAs}` }
          : { ok: false, msg: res.error ?? 'Error' },
      )
      if (res.ok) {
        setSelected(res.savedAs ?? null)
      }
    })

  const remove = () =>
    startTransition(async () => {
      if (selected === null) return
      const res = await deleteTemplateAction(selected)
      setFeedback(res.ok ? { ok: true, msg: `«${selected}» movida a .trash` } : { ok: false, msg: res.error ?? 'Error' })
      if (res.ok) {
        setSelected(null)
        setName('')
        setContent('')
      }
    })

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
      <aside>
        <ul className="space-y-1">
          {templates.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                onClick={() => pick(t)}
                aria-current={selected === t.name ? 'true' : undefined}
                className={`w-full truncate rounded-md px-3 py-2 text-left font-mono text-sm transition-colors ${
                  selected === t.name
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
                }`}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            setSelected(null)
            setName('')
            setContent('')
            setFeedback(null)
          }}
          className="mt-3 w-full rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-zinc-100"
        >
          + Nueva plantilla
        </button>
      </aside>

      <section>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="nombre-de-plantilla"
            aria-label="Nombre de la plantilla"
            className="w-64 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 font-mono text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700"
          />
          <button
            type="button"
            onClick={save}
            disabled={pending || name.trim() === ''}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
          {!isNew ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
            >
              Borrar (a .trash)
            </button>
          ) : null}
        </div>

        {feedback ? (
          <p
            role={feedback.ok ? 'status' : 'alert'}
            className={`mt-2 text-sm ${feedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {feedback.msg}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            aria-label="Contenido de la plantilla"
            spellCheck={false}
            className="min-h-[60vh] rounded-md border border-zinc-300 bg-transparent p-3 font-mono text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            placeholder={'# {{titulo}}\n\n## Pasos\n{{pasos}}\n\n## Impacto\n{{impacto}}'}
          />
          <div className="markdown-preview-frame max-h-[60vh] min-h-[60vh] overflow-auto rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
            <MarkdownPreview markdown={content} />
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          Placeholders: <code>{'{{clave}}'}</code> se sustituye · <code>{'\\{{clave}}'}</code> queda
          literal · sin valor queda visible tal cual.
        </p>
      </section>
    </div>
  )
}

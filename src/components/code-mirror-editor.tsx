'use client'

import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'

/**
 * Wrapper React mínimo de CodeMirror 6 (paso 4.3).
 *
 * - `value` es SOLO el documento inicial: el editor es la fuente de verdad
 *   mientras se escribe y comunica cambios vía `onChange` (el guardado y el
 *   autosave llegan en 4.6/4.9; recargar aún descarta cambios, by design).
 * - Se crea una única instancia en el montaje; sin SSR (CodeMirror toca DOM).
 */
export function CodeMirrorEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const view = new EditorView({
      doc: value,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
      ],
      parent: host.current!,
    })
    return () => view.destroy()
    // valor inicial solo en montaje; los cambios fluyen vía onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={host}
      className="overflow-auto rounded-md border border-zinc-300 text-sm dark:border-zinc-700 [&_.cm-editor]:max-h-[70vh] [&_.cm-editor]:min-h-[60vh] [&_.cm-scroller]:font-mono"
    />
  )
}

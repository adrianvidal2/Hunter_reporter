'use client'

import dynamic from 'next/dynamic'

// CodeMirror toca el DOM: sin SSR (mismo patrón que el visor PDF).
const MarkdownEditor = dynamic(() => import('./markdown-editor'), {
  ssr: false,
  loading: () => <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Cargando editor…</p>,
})

export function MarkdownEditorLazy(props: {
  fileName: string
  relPath: string
  initialContent: string
  initialMtimeMs: number
}) {
  return <MarkdownEditor {...props} />
}

'use client'

import dynamic from 'next/dynamic'
import type { PdfViewerProps } from './pdf-viewer'

// react-pdf exige saltarse el SSR (guía de Next App Router): este wrapper
// cliente carga el visor real solo en navegador.
const PdfViewer = dynamic(() => import('./pdf-viewer'), {
  ssr: false,
  loading: () => (
    <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Cargando visor…</p>
  ),
})

export function PdfViewerLazy(props: PdfViewerProps) {
  return <PdfViewer {...props} />
}

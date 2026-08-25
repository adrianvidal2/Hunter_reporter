'use client'

import { useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'

// Worker de pdfjs: debe configurarse en ESTE módulo (el que renderiza
// <Document>/<Page>), según la guía de react-pdf. El componente solo se
// carga en cliente (ver pdf-viewer-lazy.tsx), por eso el guard.
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
}

const MIN_SCALE = 0.5
const MAX_SCALE = 4
const SCALE_STEP = 0.25

export interface PdfViewerProps {
  /** Ruta relativa a REPORTS_ROOT (se sirve vía /api/files/raw). */
  relPath: string
  fileName: string
}

export default function PdfViewer({ relPath, fileName }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const rawUrl = `/api/files/raw?path=${encodeURIComponent(relPath)}`

  const zoom = (delta: number) =>
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + delta) * 100) / 100)))

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 truncate font-mono text-lg font-medium">{fileName}</h1>
        <a
          href={rawUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Abrir original ↗
        </a>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            aria-label="Página anterior"
            className="rounded border border-zinc-300 px-2 py-0.5 disabled:opacity-40 dark:border-zinc-700"
          >
            ‹
          </button>
          <span className="min-w-20 text-center tabular-nums">
            {numPages === null ? '…' : `${pageNumber} / ${numPages}`}
          </span>
          <button
            type="button"
            onClick={() => setPageNumber((p) => Math.min(numPages ?? p, p + 1))}
            disabled={numPages === null || pageNumber >= numPages}
            aria-label="Página siguiente"
            className="rounded border border-zinc-300 px-2 py-0.5 disabled:opacity-40 dark:border-zinc-700"
          >
            ›
          </button>
        </div>

        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => zoom(-SCALE_STEP)}
            aria-label="Reducir"
            className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setScale(1)}
            aria-label="Restablecer zoom"
            title="Restablecer zoom"
            className="min-w-14 rounded border border-zinc-300 px-2 py-0.5 tabular-nums dark:border-zinc-700"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoom(SCALE_STEP)}
            aria-label="Ampliar"
            className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700"
          >
            +
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          No se pudo cargar el PDF: {error}
        </p>
      ) : (
        <div className="mt-4 overflow-auto rounded-md border border-zinc-200 bg-zinc-100 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <Document
            file={rawUrl}
            onLoadSuccess={({ numPages: n }) => {
              setNumPages(n)
              setPageNumber(1)
              setError(null)
            }}
            onLoadError={(err) => setError(err.message)}
            loading={
              <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Cargando PDF…
              </p>
            }
            error={
              <p className="py-16 text-center text-sm text-red-600 dark:text-red-400">
                Error al cargar el documento.
              </p>
            }
            className="flex justify-center"
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer
              renderAnnotationLayer
              className="mx-auto shadow-md"
              loading={
                <p className="py-16 text-sm text-zinc-500 dark:text-zinc-400">Renderizando…</p>
              }
            />
          </Document>
        </div>
      )}
    </div>
  )
}

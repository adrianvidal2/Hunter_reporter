'use client'

import { useRef, useState } from 'react'

/**
 * Botón de copiar al portapapeles (9.5): un clic lleva el scope o el
 * user_agent a tus herramientas (Burp, scripts). Con fallback a
 * execCommand si la Clipboard API no está disponible.
 */
export function CopyButton({
  text,
  label = 'Copiar',
  title,
  compact = false,
}: {
  text: string
  label?: string
  title?: string
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      // fallback: textarea temporal + execCommand (contextos sin Clipboard API)
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (ok) {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={title ?? `Copiar: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`}
      className={
        compact
          ? 'shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 font-mono text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
          : 'shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900'
      }
    >
      {copied ? '✓ copiado' : label}
    </button>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV = [
  { href: '/', label: 'Proyectos', exact: true },
  { href: '/estructura-informe', label: 'Estructura Informe', exact: false },
  { href: '/programas', label: 'Programas', exact: false },
  { href: '/reportes', label: 'Reportes', exact: false },
  { href: '/prompts', label: 'Prompts', exact: false },
  { href: '/ajustes', label: 'Ajustes', exact: false },
] as const

/** Contador de pendientes vía SSE (6.3): se actualiza sin recargar. */
function usePendingCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('count', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as { count: number }
      setCount(data.count)
    })
    es.onerror = () => setCount(0) // si el stream cae, no mostrar badge rancio
    return () => es.close()
  }, [])
  return count
}

export function Sidebar() {
  const pathname = usePathname()
  const pending = usePendingCount()

  const item = (href: string, label: string, exact: boolean, badge?: number) => {
    const active = exact ? pathname === href : pathname.startsWith(href)
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
            : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50'
        }`}
      >
        <span className="truncate">{label}</span>
        {badge !== undefined && badge > 0 ? (
          <span
            aria-label={`${badge} reportes pendientes`}
            className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold tabular-nums text-white"
          >
            {badge}
          </span>
        ) : null}
      </Link>
    )
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="px-5 py-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          reporter
        </Link>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          gestión de reportes bug bounty
        </p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Principal">
        {NAV.map((n) => item(n.href, n.label, n.exact))}
        <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
        {item('/pendientes', 'Pendientes', false, pending)}
      </nav>
    </aside>
  )
}

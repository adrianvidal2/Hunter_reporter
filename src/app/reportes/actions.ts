'use server'

import { revalidatePath } from 'next/cache'
import { YwhApiError, YwhClient } from '@/core/ywh/client'
import { loadYwhToken, TokenExpiredError } from '@/core/ywh/token'
import { cacheAgeMs, readReportsCache, writeReportsCache } from '@/server/reports-cache'
import { writeColumnWidths } from '@/server/reports-columns'
import type { ReportSortKey, UserReport } from '@/core/ywh/reports'

/**
 * Ventana global "Reportes": lee SIEMPRE de la cache y, con "Actualizar",
 * hace la llamada en vivo y reescribe la cache sin borrarla en caso de fallo.
 */

export interface ReportsView {
  items: UserReport[]
  cachedAt: number | null // null si no hay cache
  ageMs: number
}

export async function getReportsViewAction(): Promise<{ ok: true; view: ReportsView }> {
  const cache = readReportsCache()
  return {
    ok: true,
    view: {
      items: cache?.items ?? [],
      cachedAt: cache?.savedAt ?? null,
      ageMs: cacheAgeMs(cache),
    },
  }
}

export type RefreshReportsResult =
  | { ok: true; view: ReportsView; refreshed: true }
  | { ok: false; view: ReportsView; stale: true; error: string }

/**
 * Actualiza la cache con la llamada en vivo. En cualquier fallo (token
 * caducado, red, 404 del gateway, rate limit…) NO borra la cache: se
 * devuelve lo último y un aviso.
 */
export async function refreshReportsAction(): Promise<RefreshReportsResult> {  const before = readReportsCache()
  const baseView = (): ReportsView => ({
    items: before?.items ?? [],
    cachedAt: before?.savedAt ?? null,
    ageMs: cacheAgeMs(before),
  })

  const token = loadYwhToken()
  if (!token) {
    return { ok: false, view: baseView(), stale: true, error: 'No hay token en Ajustes.' }
  }

  try {
    const res = await new YwhClient(token).fetchAllMyReports()
    writeReportsCache(res.items)
    const cache = readReportsCache()
    revalidatePath('/reportes')
    return {
      ok: true,
      refreshed: true,
      view: { items: res.items, cachedAt: cache?.savedAt ?? Date.now(), ageMs: 0 },
    }
  } catch (err) {
    // Mantener la cache: no borrar lo último pase lo que pase.
    let msg: string
    if (err instanceof TokenExpiredError) {
      msg = 'Sesión caducada, renueva el token en Ajustes.'
    } else if (err instanceof YwhApiError && (err.kind === 'auth' || err.kind === 'not_found')) {
      msg = 'Sesión caducada, renueva el token en Ajustes.'
    } else if (err instanceof YwhApiError) {
      msg = `No se pudo actualizar: ${err.message}`
    } else {
      msg = err instanceof Error ? err.message : 'Error inesperado'
    }
    return { ok: false, view: baseView(), stale: true, error: msg }
  }
}

/** Persiste los anchos de columna (config, no localStorage). */
export async function saveReportsColumnsAction(
  widths: Partial<Record<ReportSortKey, number>>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    writeColumnWidths(widths)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

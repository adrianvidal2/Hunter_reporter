import Link from 'next/link'
import { ProgramasExplorer } from '@/components/programas-explorer'
import { listProjects } from '@/core/fs/tree'
import { YwhClient, YwhApiError } from '@/core/ywh/client'
import { loadYwhToken, TokenExpiredError } from '@/core/ywh/token'
import type { ShortProgram } from '@/core/ywh/types'

export const dynamic = 'force-dynamic'

/**
 * Programas de YesWeHack (9.5): lista con filtros + detalle con scope in/out
 * y user_agent copiables. El token vive solo en el servidor.
 */
export default async function ProgramasPage() {
  const token = loadYwhToken()

  let programs: ShortProgram[]
  let fetchError: string | null = null
  let tokenProblem = false
  try {
    programs = (await new YwhClient(token).fetchAllPrograms()).items
  } catch (err) {
    programs = []
    tokenProblem = err instanceof TokenExpiredError || (err instanceof YwhApiError && err.kind === 'auth')
    fetchError = err instanceof Error ? err.message : 'Error inesperado'
  }

  if (fetchError) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Programas</h1>
        <div role="alert" className="mt-6 max-w-xl rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <p>No se pudo cargar la lista de programas: {fetchError}</p>
          {tokenProblem ? (
            <p className="mt-2">
              El JWT caducó o no es válido:{' '}
              <Link href="/ajustes" className="underline">
                pega uno nuevo en Ajustes
              </Link>
              .
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Programas</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {programs.length} programas de YesWeHack
        {token ? ` (${programs.filter((p) => !p.public).length} privados)` : ' · sin token: solo públicos'}.
        El scope y el User-Agent del detalle se copian de un clic.
      </p>
      <div className="mt-4">
        <ProgramasExplorer programs={programs} hasToken={token !== null} localProjects={listProjects()} />
      </div>
    </div>
  )
}

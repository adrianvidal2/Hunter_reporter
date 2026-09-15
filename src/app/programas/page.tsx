import { ProgramasTabs } from '@/components/programas-tabs'
import { listProjects } from '@/core/fs/tree'

export const dynamic = 'force-dynamic'

/**
 * Programas (paso 4): DOS subpestanas (YesWeHack | Intigriti) dentro de la
 * única entrada «Programas» del sidebar. Ninguna carga datos hasta que el
 * usuario la pulsa: el fetch vive en server actions llamadas desde cada
 * subpestana al montarse. El token/PAT nunca cruza al cliente.
 */
export default function ProgramasPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Programas</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Explorador por plataforma: lista con filtros, detalle con scope y requisitos copiables, y
        creación de proyecto local con <code className="font-mono text-xs">platform.json</code>.
      </p>
      <ProgramasTabs localProjects={listProjects()} />
    </div>
  )
}

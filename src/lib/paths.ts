import { homedir } from 'node:os'

/** Expande `~` inicial a la home del usuario (apoya rutas tipo
 *  `~/tools/orca-linux.AppImage` sin depender del shell). */
export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return homedir() + p.slice(1)
  return p
}
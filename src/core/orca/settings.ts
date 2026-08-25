import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Ajustes de Orca (ruta del binario). Viven en `<app>/.settings/orca.json`
 * (en claro: no es un secreto). La ruta por defecto es
 * `~/tools/orca-linux.AppImage`; se puede cambiar desde Ajustes.
 */

export const DEFAULT_ORCA_BIN = '~/tools/orca-linux.AppImage'

export interface OrcaSettings {
  /** Ruta del binario de Orca (puede contener `~`). */
  orcaBin: string
}

export function settingsDir(): string {
  return path.join(process.cwd(), '.settings')
}

function orcaFile(): string {
  return path.join(settingsDir(), 'orca.json')
}

export function loadOrcaSettings(): OrcaSettings {
  try {
    const file = orcaFile()
    if (!existsSync(file)) return { orcaBin: DEFAULT_ORCA_BIN }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { orcaBin?: unknown }
    const bin = typeof raw.orcaBin === 'string' && raw.orcaBin.trim() !== '' ? raw.orcaBin : DEFAULT_ORCA_BIN
    return { orcaBin: bin }
  } catch {
    return { orcaBin: DEFAULT_ORCA_BIN }
  }
}

export function saveOrcaSettings(input: { orcaBin: string }): OrcaSettings {
  const orcaBin = input.orcaBin.trim() === '' ? DEFAULT_ORCA_BIN : input.orcaBin.trim()
  mkdirSync(settingsDir(), { recursive: true })
  writeFileSync(orcaFile(), JSON.stringify({ orcaBin }, null, 2) + '\n', { mode: 0o600 })
  return { orcaBin }
}

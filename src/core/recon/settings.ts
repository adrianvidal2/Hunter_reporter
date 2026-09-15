import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { settingsDir } from '../llm/settings'
import { TOOL_IDS, type ToolId } from './tools'

/**
 * Ajustes de recon (diseño aprobado): ruta POR BINARIO con indicador — no
 * un PATH único. Vive en `.settings/recon.json` (sin secretos: solo rutas),
 * con el mismo mecanismo de cifrado que el resto no hace falta.
 */

export interface ReconSettings {
  /** Ruta del binario por herramienta; ausente → se usa el nombre desnudo (PATH). */
  binPaths: Partial<Record<ToolId, string>>
  /** Wordlist por defecto para ffuf/gobuster. */
  wordlist?: string
  /** Timeout por ejecución en minutos (por defecto 30, tope 24 h). */
  timeoutMinutes?: number
}

const DEFAULTS: ReconSettings = { binPaths: {} }

function reconFile(): string {
  return path.join(settingsDir(), 'recon.json')
}

export function loadReconSettings(): ReconSettings {
  if (!existsSync(reconFile())) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(reconFile(), 'utf8')) as Partial<ReconSettings>
    const binPaths: ReconSettings['binPaths'] = {}
    for (const id of TOOL_IDS) {
      const p = raw.binPaths?.[id]
      if (typeof p === 'string' && p.trim() !== '') binPaths[id] = p.trim()
    }
    return {
      binPaths,
      wordlist: typeof raw.wordlist === 'string' && raw.wordlist.trim() !== '' ? raw.wordlist.trim() : undefined,
      timeoutMinutes:
        typeof raw.timeoutMinutes === 'number' && raw.timeoutMinutes > 0 && raw.timeoutMinutes <= 24 * 60
          ? raw.timeoutMinutes
          : undefined,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveReconSettings(settings: ReconSettings): void {
  const binPaths: ReconSettings['binPaths'] = {}
  for (const id of TOOL_IDS) {
    const p = settings.binPaths?.[id]
    if (typeof p === 'string' && p.trim() !== '') binPaths[id] = p.trim()
  }
  const clean: ReconSettings = {
    binPaths,
    wordlist: settings.wordlist?.trim() || undefined,
    timeoutMinutes:
      settings.timeoutMinutes && settings.timeoutMinutes > 0 && settings.timeoutMinutes <= 24 * 60
        ? settings.timeoutMinutes
        : undefined,
  }
  mkdir()
  writeFileSync(reconFile(), JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 })
}

/** Ruta del binario para una herramienta: ajustes → nombre desnudo (PATH). */
export function resolveBinPath(toolId: ToolId): string {
  return loadReconSettings().binPaths[toolId] ?? toolId
}

function mkdir(): void {
  mkdirSync(settingsDir(), { recursive: true })
}

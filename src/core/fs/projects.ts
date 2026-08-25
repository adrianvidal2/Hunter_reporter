import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'

/**
 * Creación de proyectos y carpetas del sistema (paso 1.8).
 *
 * Estructura por proyecto (la del plan):
 *
 *   <root>/<nombre>/
 *   ├── REPORTES_YWH/
 *   └── reportes/
 */

/** El nombre no es válido como proyecto. `reason` explica el porqué. */
export class InvalidProjectNameError extends Error {
  constructor(name: string, reason: string) {
    super(`Nombre de proyecto inválido (${reason}): ${JSON.stringify(name)}`)
    this.name = 'InvalidProjectNameError'
  }
}

/** Ya existe un proyecto con ese nombre. */
export class ProjectExistsError extends Error {
  constructor(name: string) {
    super(`Ya existe un proyecto llamado ${JSON.stringify(name)}`)
    this.name = 'ProjectExistsError'
  }
}

const MAX_NAME_BYTES = 200

/**
 * Valida un nombre de proyecto: un único segmento, sin separadores, puntos
 * iniciales ni caracteres de control; `_inbox` está reservado. Devuelve el
 * nombre normalizado a NFC.
 *
 * Nota: aquí se RECHAZA en vez de sanear (a diferencia de sanitizeFilename,
 * que limpia): crear un proyecto es una acción explícita del usuario y un
 * nombre mutado silenciosamente sería una sorpresa, no una ayuda.
 */
function validateProjectName(name: string): string {
  if (typeof name !== 'string') {
    throw new InvalidProjectNameError(String(name), 'no es un string')
  }
  const nfc = name.normalize('NFC')
  if (nfc === '') throw new InvalidProjectNameError(name, 'vacío')
  if (nfc !== nfc.trim()) throw new InvalidProjectNameError(name, 'espacios al inicio o al final')
  if (/[\u0000-\u001f\u007f]/.test(nfc)) {
    throw new InvalidProjectNameError(name, 'contiene caracteres de control')
  }
  if (/[/\\]/.test(nfc)) throw new InvalidProjectNameError(name, 'contiene separadores')
  if (nfc.startsWith('.')) throw new InvalidProjectNameError(name, 'empieza por punto')
  if (nfc === '_inbox') throw new InvalidProjectNameError(name, 'nombre reservado')
  if (Buffer.byteLength(nfc, 'utf8') > MAX_NAME_BYTES) {
    throw new InvalidProjectNameError(name, `supera ${MAX_NAME_BYTES} bytes`)
  }
  return nfc
}

/**
 * Crea un proyecto con sus dos subcarpetas (`REPORTES_YWH/` y `reportes/`).
 *
 * Aclaración bloque 9: NO destructivo ni exclusivo — un proyecto puede
 * tener MÁS subdirectorios (notas, capturas, scripts, recon…). Si el
 * directorio ya existe con otras carpetas dentro, solo se crean las dos
 * que falten y NO se toca nada más. Idempotente: no lanza si ya existe.
 */
export function createProject(name: string, root: string = getEnv().REPORTS_ROOT): string {
  const valid = validateProjectName(name)
  const realRoot = realpathSync(root)
  const dir = path.join(realRoot, valid)

  mkdirSync(dir, { recursive: true }) // idempotente: si ya existe, se respeta
  for (const sub of ['REPORTES_YWH', 'reportes']) {
    const p = path.join(dir, sub)
    if (!existsSync(p)) mkdirSync(p) // solo las que falten; el resto, intacto
  }
  return dir
}

/** ¿Ya existían las dos subcarpetas antes? (para dar error de duplicado
 *  en la UI cuando no hay nada nuevo que crear). */
export function projectStructureExists(name: string, root: string = getEnv().REPORTS_ROOT): boolean {
  if (typeof name !== 'string' || name === '' || /[\\/]/.test(name) || name.includes('..')) return false
  const dir = path.join(realpathSync(root), name)
  return existsSync(path.join(dir, 'REPORTES_YWH')) && existsSync(path.join(dir, 'reportes'))
}

/**
 * Garantiza que existe `_inbox/` en la raíz (destino del POST de ingesta,
 * paso 5.1). Idempotente: no falla si ya existe.
 *
 * @returns Ruta absoluta de `<root>/_inbox`.
 */
export function ensureInbox(root: string = getEnv().REPORTS_ROOT): string {
  const realRoot = realpathSync(root)
  const inbox = path.join(realRoot, '_inbox')
  mkdirSync(inbox, { recursive: true })
  return inbox
}

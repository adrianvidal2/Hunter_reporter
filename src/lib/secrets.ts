import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'

/**
 * Cifrado en reposo para secretos locales (8.1): AES-256-GCM.
 *
 * La clave de cifrado (32 bytes) vive en `<dir>/.secret-key` con permisos
 * 0600, generada on demand. Honestidad sobre el modelo de amenaza: en una
 * app local con clave y ciphertext en la misma máquina, esto NO protege de
 * un atacante con acceso total al disco; protege de que la API key aparezca
 * en CLARO en ficheros que se copian, se backupean o se pegan por error
 * (logs, dotfiles, el propio JSON de settings). Es lo que el plan pide.
 */

const FORMAT = 'v1'

/** Obtiene (creando si falta) la clave maestra de cifrado. */
export function getOrCreateMasterKey(secretsDir: string): Buffer {
  mkdirSync(secretsDir, { recursive: true })
  const keyFile = path.join(secretsDir, '.secret-key')
  if (!existsSync(keyFile)) {
    writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 })
    chmodSync(keyFile, 0o600)
  }
  return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex')
}

/** Cifra; devuelve `v1.<iv>.<tag>.<data>` (todo hex). IV aleatorio por llamada. */
export function encryptWithKey(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [FORMAT, iv.toString('hex'), tag.toString('hex'), data.toString('hex')].join('.')
}

/** Descifra lo producido por encryptWithKey. Lanza si está alterado. */
export function decryptWithKey(key: Buffer, payload: string): string {
  const [format, ivHex, tagHex, dataHex] = payload.split('.')
  if (format !== FORMAT || !ivHex || !tagHex || !dataHex) {
    throw new Error('Payload cifrado con formato desconocido')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

/** Deriva una clave desde un secret legible (reserva para otros usos). */
export function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'reporter-settings-salt', 32)
}

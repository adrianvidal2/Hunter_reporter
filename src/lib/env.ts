import { accessSync, constants, statSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

/**
 * Validación del entorno de la app.
 *
 * La única variable obligatoria hoy es REPORTS_ROOT: la carpeta de proyectos
 * que la app gestiona. Next.js la carga automáticamente desde `.env.local`
 * en `process.env`.
 */

/** Error de configuración: el mensaje va pensado para leerlo un humano. */
export class EnvError extends Error {
  constructor(messages: string[]) {
    super(messages.join('\n'))
    this.name = 'EnvError'
  }
}

const reportsRoot = z
  .string({
    error: 'REPORTS_ROOT no está definida. Añádela a .env.local, p. ej. REPORTS_ROOT=/ruta/a/reportes',
  })
  .trim()
  .min(1, 'REPORTS_ROOT está vacía: debe ser la ruta a la carpeta de reportes')
  .superRefine((value, ctx) => {
    const dir = path.resolve(value)
    try {
      const stats = statSync(dir)
      if (!stats.isDirectory()) {
        ctx.addIssue({ code: 'custom', message: `REPORTS_ROOT "${dir}" existe pero no es un directorio` })
        return
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: `REPORTS_ROOT "${dir}" no existe` })
      return
    }
    try {
      accessSync(dir, constants.W_OK)
    } catch {
      ctx.addIssue({ code: 'custom', message: `REPORTS_ROOT "${dir}" no es escribible` })
    }
  })
  .transform((value) => path.resolve(value))

const envSchema = z.object({ REPORTS_ROOT: reportsRoot })

export type Env = z.infer<typeof envSchema>

/**
 * Valida un entorno crudo. Separado de `process.env` para poder testear
 * sin depender del entorno real del proceso.
 */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    throw new EnvError(result.error.issues.map((issue) => issue.message))
  }
  return result.data
}

let cached: Env | undefined

/**
 * Lee y valida REPORTS_ROOT de `process.env` (Next la carga de `.env.local`).
 * Lanza `EnvError` al primer uso si la configuración no es válida.
 * Memoizada: un proceso no cambia de REPORTS_ROOT a mitad de ejecución.
 */
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env))
}

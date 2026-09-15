'use client'

import { useState, useTransition } from 'react'
import {
  clearIntigritiTokenAction,
  saveIntigritiTokenAction,
  testIntigritiConnectionAction,
} from '@/app/ajustes/actions'
import type { IntigritiTokenStatus } from '@/core/intigriti/token'

/**
 * Sección Intigriti de Ajustes (paso 3): PAT opaco de larga duración, sin
 * claim exp — por eso, a diferencia de YWH, aquí no hay contador de
 * caducidad sino un botón «Probar conexión» como el de los providers LLM
 * del 8.1. El PAT vive cifrado en `.settings/intigriti.json` y jamás vuelve
 * al cliente: solo máscara con los últimos 4 caracteres.
 */

/** Limpia espacios y saltos (extremos y dentro) al pegar. */
const clean = (raw: string) => raw.replace(/\s+/g, '')

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 font-mono text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700'

export function IntigritiTokenSection({ current }: { current: IntigritiTokenStatus }) {
  const [pat, setPat] = useState('')
  const [status, setStatus] = useState<IntigritiTokenStatus>(current)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const save = () =>
    startTransition(async () => {
      const res = await saveIntigritiTokenAction(pat)
      if (res.ok) {
        setStatus(res.status!)
        setPat('')
        setTest(null)
        setFeedback({ ok: true, msg: 'Token guardado (cifrado en .settings/intigriti.json)' })
      } else {
        setFeedback({ ok: false, msg: res.error ?? 'Error' })
      }
    })

  const clear = () =>
    startTransition(async () => {
      const res = await clearIntigritiTokenAction()
      setStatus(res.status!)
      setTest(null)
      setFeedback({ ok: true, msg: 'Token local borrado (el de .env.local, si existe, vuelve a mandar)' })
    })

  const testConnection = () => {
    setTest(null)
    startTransition(async () => {
      // usa el del formulario si hay; si no, el guardado
      const res = await testIntigritiConnectionAction(pat)
      setTest(
        res.ok
          ? { ok: true, msg: `Conexión OK (${res.latencyMs} ms) — programas visibles: ${res.programCount}` }
          : { ok: false, msg: res.error ?? 'Error' },
      )
    })
  }

  return (
    <section aria-label="Token de Intigriti" className="mt-10 max-w-2xl">
      <h2 className="text-lg font-semibold tracking-tight">Intigriti</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        PAT de larga duración (perfil → API → researcher). Es opaco y no lleva fecha de caducidad:
        usa «Probar conexión» para comprobar que sigue válido. La API no tiene endpoints públicos:
        sin token la pestaña de Intigriti no puede cargar nada.
      </p>

      <p className="mt-3 text-sm">
        {status.source === null ? (
          <span className="text-zinc-500 dark:text-zinc-400">
            Sin token: pega tu PAT para usar Intigriti.
          </span>
        ) : (
          <>
            <span className="font-medium">
              {status.source === 'ui' ? 'Guardado en Ajustes (cifrado)' : 'Desde .env.local'}
            </span>
            {status.mask ? <code className="ml-2 font-mono text-xs">{status.mask}</code> : null}
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <div className="min-w-64 flex-1">
          <input
            type="password"
            value={pat}
            onChange={(e) => setPat(clean(e.target.value))}
            onPaste={(e) => {
              // limpia espacios/saltos del portapapeles antes de aceptarlos
              e.preventDefault()
              setPat(clean(e.clipboardData.getData('text')))
            }}
            placeholder="Pega tu PAT de Intigriti"
            aria-label="PAT de Intigriti"
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
          />
          {feedback ? (
            <p
              role={feedback.ok ? 'status' : 'alert'}
              className={`mt-1.5 text-xs ${feedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
            >
              {feedback.msg}
            </p>
          ) : null}
          {test ? (
            <p
              role={test.ok ? 'status' : 'alert'}
              className={`mt-1.5 text-xs ${test.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
            >
              {test.msg}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={pending || pat === ''}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? 'Guardando…' : 'Guardar token'}
        </button>
        <button
          type="button"
          onClick={testConnection}
          disabled={pending || (pat === '' && status.source === null)}
          className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {pending ? 'Probando…' : 'Probar conexión'}
        </button>
        {status.source === 'ui' ? (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="rounded-md border border-red-300 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
          >
            Quitar
          </button>
        ) : null}
      </div>
    </section>
  )
}

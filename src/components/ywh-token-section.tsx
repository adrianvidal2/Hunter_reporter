'use client'

import { useState, useTransition } from 'react'
import { clearYwhTokenAction, saveYwhTokenAction } from '@/app/ajustes/actions'
import type { YwhTokenStatus } from '@/core/ywh/token'

/**
 * Sección YesWeHack de Ajustes (9.3): el JWT de sesión caduca cada pocas
 * horas; esta es la vía principal para renovarlo (cifrado en .settings/,
 * sin editar .env ni reiniciar). YWH_JWT de .env.local es fallback.
 */

function humanExpires(iso: string | null): string {
  if (!iso) return 'sin fecha de caducidad legible'
  const ms = new Date(iso).getTime() - Date.now()
  const min = Math.round(ms / 60_000)
  if (min <= 0) return `caducado hace ${Math.abs(min)} min`
  if (min < 60) return `caduca en ${min} min`
  return `caduca en ${Math.floor(min / 60)} h ${min % 60} min`
}

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 font-mono text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700'

export function YwhTokenSection({ current }: { current: YwhTokenStatus }) {
  const [jwt, setJwt] = useState('')
  const [status, setStatus] = useState<YwhTokenStatus>(current)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const save = () =>
    startTransition(async () => {
      const res = await saveYwhTokenAction(jwt)
      if (res.ok) {
        setStatus(res.status!)
        setJwt('')
        setFeedback({ ok: true, msg: 'Token guardado (cifrado en .settings/ywh.json)' })
      } else {
        setFeedback({ ok: false, msg: res.error ?? 'Error' })
      }
    })

  const clear = () =>
    startTransition(async () => {
      const res = await clearYwhTokenAction()
      setStatus(res.status!)
      setFeedback({ ok: true, msg: 'Token local borrado (el de .env.local, si existe, vuelve a mandar)' })
    })

  return (
    <section aria-label="Token de YesWeHack" className="mt-10 max-w-2xl">
      <h2 className="text-lg font-semibold tracking-tight">YesWeHack</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        JWT de sesión (localStorage <code>access_token</code>, como yeswecaido). Caduca cada pocas
        horas: renuévalo aquí. Con token ves también tus programas privados; sin él, solo públicos.
      </p>

      <p className="mt-3 text-sm">
        {status.source === null ? (
          <span className="text-zinc-500 dark:text-zinc-400">
            Sin token: solo se listarán programas públicos.
          </span>
        ) : (
          <>
            <span className="font-medium">
              {status.source === 'ui' ? 'Guardado en Ajustes (cifrado)' : 'Desde .env.local'}
            </span>
            {status.mask ? <code className="ml-2 font-mono text-xs">{status.mask}</code> : null}
            <span
              className={`ml-2 ${status.expired ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
            >
              · {humanExpires(status.expiresAt)}
              {status.expired ? ' — pega uno nuevo' : ''}
            </span>
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <div className="min-w-64 flex-1">
          <textarea
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
            placeholder="eyJhbGciOi… (pega el JWT completo)"
            aria-label="JWT de YesWeHack"
            rows={2}
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
        </div>
        <button
          type="button"
          onClick={save}
          disabled={pending || jwt.trim() === ''}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? 'Guardando…' : 'Guardar token'}
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

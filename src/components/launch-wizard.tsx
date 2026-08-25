'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import type { PromptMeta } from '@/core/prompts/prompts'
import { createPromptAction } from '@/app/prompts/actions'
import { launchOrcaAction } from '@/app/proyectos/[project]/launch'
import type { Program } from '@/core/ywh/types'
import {
  buildLaunchDraft,
  DEFAULT_LAUNCH_MODE,
  ENGINES,
  LAUNCH_MODES,
  promptContentFor,
  promptIsEmpty,
  savedAsName,
  toggleProvider,
  validateLaunch,
  type LaunchMode,
} from '@/core/ywh/launch-form'

/**
 * Asistente "Lanzar" en dos pasos (pestaña Programa).
 *
 * PASO 1 — Scope y credenciales (recoge).
 * PASO 2 — Proveedores (multi-selección) + Prompt (biblioteca / al vuelo).
 *
 * EN ESTE paso NO se ejecuta nada ni se persiste a disco al confirmar:
 * solo se recoge la selección en memoria (no toca info.md). La lista de
 * prompts viene del server (reutiliza el loader de la ventana Prompts).
 */

interface WizardProps {
  project: string
  program: Program
  prompts: PromptMeta[]
  onClose: () => void
}

type Step = 1 | 2 | 3

export function LaunchWizard({ project, program, prompts, onClose }: WizardProps) {
  const [step, setStep] = useState<Step>(1)
  const [checked, setChecked] = useState<Set<string>>(new Set(program.scopes.map((s) => s.scope)))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // PASO 2 — proveedores (multi) + prompt
  const [providers, setProviders] = useState<Set<string>>(new Set())
  const [promptSlug, setPromptSlug] = useState<string | null>(null)
  const [promptText, setPromptText] = useState('')
  const [saveNote, setSaveNote] = useState<string | null>(null)

  // PASO 3 — modo de lanzamiento (radio exclusivo; Orca por defecto)
  const [mode, setMode] = useState<LaunchMode>(DEFAULT_LAUNCH_MODE)

  // Resultado del lanzamiento Orca (vacío = sin lanzar todavía)
  const [launchOutcome, setLaunchOutcome] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const backdropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, onClose])

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (backdropRef.current && e.target === backdropRef.current && !pending) onClose()
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [pending, onClose])

  const allChecked = checked.size === program.scopes.length
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(program.scopes.map((s) => s.scope)))
  const toggle = (scope: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })

  // Selector de prompt de la biblioteca → carga su texto en el editor.
  const pickPrompt = (slug: string) => {
    setPromptSlug(slug)
    setPromptText(promptContentFor(prompts, slug))
    setSaveNote(null)
  }

  // "Guardar como": crea <nombre>_<programa> sin pisar el original.
  const saveAs = () => {
    setError(null)
    setSaveNote(null)
    const name = savedAsName(promptSlug ?? 'prompt', project)
    startTransition(async () => {
      const res = await createPromptAction(name, promptText)
      if (res.ok) {
        setSaveNote(`Guardado como ${res.data.slug}.md en la biblioteca.`)
      } else {
        setError(res.error ?? 'No se pudo guardar.')
      }
    })
  }

  // Confirmar: en modo Orca lanza el worktree (solo proveedor Pi por ahora).
  const confirm = () => {
    const err = validateLaunch(providers, promptText)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setLaunchOutcome(null)

    const draft = buildLaunchDraft({
      assets: [...checked],
      username,
      password,
      providers,
      prompt: promptText,
      mode,
    })

    if (mode === 'orca') {
      if (!providers.has('Pi')) {
        setError('El modo Orca por ahora solo soporta el proveedor Pi.')
        return
      }
      setLaunching(true)
      startTransition(async () => {
        const res = await launchOrcaAction({
          project,
          selectedScopes: draft.assets,
          mode: 'orca',
          prompt: draft.prompt,
        })
        setLaunching(false)
        setSaveNote(null)
        if (res.ok) {
          setLaunchOutcome(
            `✓ Worktree ${res.worktreeId ?? ''} creado${res.handle ? ` (handle ${res.handle})` : ''}.` +
              (res.note ? ` ${res.note}` : ''),
          )
        } else {
          setError(res.error)
        }
      })
    } else {
      // Modo Terminal: fase posterior, solo recoge en memoria.
      setSaveNote(
        `Recogido en memoria: ${draft.providers.length} proveedor(es), prompt listo, modo «${draft.mode}». (Modo Terminal aún no implementado.)`,
      )
    }
  }

  const cancelProvider = (name: string) => setProviders((prev) => toggleProvider(prev, name))

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/60 p-4 pt-16 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Lanzar programa"
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Lanzar · {program.title || program.slug}</h2>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Cerrar" className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
            ✕
          </button>
        </div>

        {/* stepper */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span className={step === 1 ? 'font-semibold text-zinc-900 dark:text-zinc-100' : ''}>1 · Scope y credenciales</span>
          <span>→</span>
          <span className={step === 2 ? 'font-semibold text-zinc-900 dark:text-zinc-100' : ''}>2 · Proveedores y prompt</span>
          <span>→</span>
          <span className={step === 3 ? 'font-semibold text-zinc-900 dark:text-zinc-100' : ''}>3 · Modo de lanzamiento</span>
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
        ) : null}
        {saveNote ? (
          <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{saveNote}</p>
        ) : null}

        {step === 1 ? (
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Scope in ({checked.size}/{program.scopes.length})</h3>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4" />
                  Seleccionar todo
                </label>
              </div>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {program.scopes.map((s) => (
                  <li key={s.scope} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked.has(s.scope)}
                      onChange={() => toggle(s.scope)}
                      className="h-4 w-4"
                    />
                    <label className="min-w-0 flex-1 cursor-pointer truncate font-mono text-xs" title={s.scope}>
                      {s.scope}
                    </label>
                    <span className="shrink-0 text-xs text-zinc-400">{s.scope_type_name ?? s.scope_type}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Usuario (opcional, cuenta de test)</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700" autoComplete="off" />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Contraseña (opcional, texto plano)</span>
                <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700" autoComplete="off" />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700">Cancelar</button>
              <button type="button" onClick={() => setStep(2)} className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
                Siguiente →
              </button>
            </div>
          </div>
        ) : step === 2 ? (
          <div className="mt-4 space-y-4">
            {/* Proveedores (multi) */}
            <div>
              <h3 className="text-sm font-semibold">
                Proveedores <span className="text-zinc-400">({providers.size} marcados)</span>
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Puedes marcar varios, en cualquier combinación.</p>
              <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {ENGINES.map((name) => {
                  const active = providers.has(name)
                  return (
                    <li key={name}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800'
                            : 'border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900'
                        }`}
                      >
                        <input type="checkbox" checked={active} onChange={() => cancelProvider(name)} className="h-4 w-4" />
                        {name}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* Prompt: biblioteca / al vuelo */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Prompt</h3>
                <button
                  type="button"
                  onClick={saveAs}
                  disabled={pending || promptText.trim() === ''}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  title="Guarda este texto como un prompt NUEVO en la biblioteca (no pisa el original)"
                >
                  Guardar como…
                </button>
              </div>
              <select
                value={promptSlug ?? ''}
                onChange={(e) => pickPrompt(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:[color-scheme:dark]"
                aria-label="Elegir prompt de la biblioteca"
              >
                <option value="">— escribir uno nuevo —</option>
                {prompts.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.name} ({p.slug})</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-zinc-400">
                Elegir uno carga su texto abajo; puedes editarlo sin tocar el original. Si no eliges ninguno, escribe tu prompt aquí.
              </p>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={7}
                placeholder="Escribe aquí el prompt…"
                className="mt-1.5 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:[color-scheme:dark]"
              />
              {promptIsEmpty(promptText) ? (
                <p role="alert" className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  El prompt no puede estar vacío para confirmar.
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setStep(1)} disabled={pending} className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700">← Atrás</button>
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={providers.size === 0 || promptIsEmpty(promptText)}
                title={promptIsEmpty(promptText) ? 'El prompt no puede estar vacío' : undefined}
                className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Siguiente →
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Modo de lanzamiento</h3>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Elige una opción (excluyente). Orca crea un worktree (proveedor Pi); Terminal queda para una fase posterior.</p>
              <ul className="mt-2 space-y-1.5">
                {LAUNCH_MODES.map(({ value, label }) => {
                  const active = mode === value
                  return (
                    <li key={value}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800'
                            : 'border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900'
                        }`}
                      >
                        <input
                          type="radio"
                          name="launch-mode"
                          checked={active}
                          onChange={() => setMode(value)}
                          className="h-4 w-4"
                        />
                        {label}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>

            {launching ? (
              <p role="status" className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                Lanzando… (creando worktree de Orca; puede tardar un poco)
              </p>
            ) : null}
            {launchOutcome ? (
              <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {launchOutcome}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setStep(2)} disabled={pending} className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700">← Atrás</button>
              <button
                type="button"
                onClick={confirm}
                disabled={promptIsEmpty(promptText) || launching}
                title={promptIsEmpty(promptText) ? 'El prompt no puede estar vacío' : undefined}
                className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {launching ? 'Lanzando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

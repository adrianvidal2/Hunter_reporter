import { PromptsManager } from '@/components/prompts-manager'
import { listPrompts, ensurePromptsDir } from '@/core/prompts/prompts'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/** Prompts globales de la app (.config/prompts): CRUD gestión. */
export default async function PromptsPage() {
  const root = getEnv().REPORTS_ROOT
  ensurePromptsDir(root) // si no existe, créalo (estado vacío si nada)
  const prompts = listPrompts(root)

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Prompts</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Prompts globales para asistentes ({prompts.length}). Se guardan como{' '}
        <code className="font-mono">.md</code> en{' '}
        <code className="font-mono">.config/prompts/</code>.
      </p>
      <div className="mt-4 max-w-3xl">
        <PromptsManager initial={prompts} />
      </div>
    </div>
  )
}

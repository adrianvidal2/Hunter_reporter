import { TemplatesManager, type TemplateItem } from '@/components/templates-manager'
import { ensureDefaultTemplate, listTemplates, readTemplate } from '@/core/reports/templates'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Estructura Informe (paso 7.1): gestión de plantillas en
 * `<REPORTS_ROOT>/.config/templates/`. El placeholder por defecto tipo YWH
 * llega en 7.3.
 */
export default function EstructuraInformePage() {
  const root = getEnv().REPORTS_ROOT
  ensureDefaultTemplate(root) // 7.3: ywh.md por defecto si falta (idempotente)

  const templates: TemplateItem[] = listTemplates(root).map((name) => ({
    name,
    content: (() => {
      try {
        return readTemplate(name, root).content
      } catch {
        return '' // borrada entre list y read: la próxima render la omite
      }
    })(),
  }))

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Estructura Informe</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Plantillas de informe con placeholders <code>{'{{clave}}'}</code>. Viven en{' '}
        <code>.config/templates/</code> dentro de la carpeta de reportes.
      </p>
      <TemplatesManager templates={templates} />
    </div>
  )
}

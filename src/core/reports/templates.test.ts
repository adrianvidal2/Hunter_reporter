import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderTemplate, templatePlaceholders } from './placeholders'
import { createFixture } from '../../test/fixtures/fixture'
import {
  DEFAULT_TEMPLATE,
  DEFAULT_TEMPLATE_NAME,
  InvalidTemplateNameError,
  deleteTemplate,
  ensureDefaultTemplate,
  ensureTemplatesDir,
  findTemplate,
  listProjectTemplates,
  listTemplates,
  listTemplateOptions,
  readTemplate,
  saveTemplate,
} from './templates'

describe('templates en .config/templates (7.1)', () => {
  it('crear → listar → leer → editar (sobrescribe) round-trip', () => {
    const fx = createFixture()
    try {
      expect(listTemplates(fx.root)).toEqual([]) // sin .config: lista vacía

      const name = saveTemplate('ywh', '# Plantilla YWH\n\n## Pasos\n{{pasos}}', fx.root)
      expect(name).toBe('ywh.md')
      expect(listTemplates(fx.root)).toEqual(['ywh.md'])

      expect(readTemplate('ywh', fx.root).content).toContain('{{pasos}}')

      // editar = sobrescribir
      saveTemplate('ywh.md', '# YWH v2', fx.root)
      expect(readTemplate('ywh', fx.root).content).toBe('# YWH v2')

      // ruta física correcta
      const dir = ensureTemplatesDir(fx.root)
      expect(path.basename(dir)).toBe('templates')
      expect(readdirSync(dir)).toEqual(['ywh.md'])
    } finally {
      fx.cleanup()
    }
  })

  it('borrar mueve a .trash (recuperable) y devuelve false si no existía', () => {
    const fx = createFixture()
    try {
      saveTemplate('temporal', 'contenido valioso', fx.root)
      expect(deleteTemplate('temporal', fx.root)).toBe(true)
      expect(listTemplates(fx.root)).toEqual([])

      const trash = path.join(fx.root, '.trash')
      const entries = readdirSync(trash)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatch(/temporal\.md$/)
      expect(readFileSync(path.join(trash, entries[0]!), 'utf8')).toBe('contenido valioso')

      expect(deleteTemplate('temporal', fx.root)).toBe(false) // ya no está
    } finally {
      fx.cleanup()
    }
  })

  it('nombres inválidos rechazados: separadores, .., vacío', () => {
    const fx = createFixture()
    try {
      for (const bad of ['../fuera', 'a/b', 'a\\b', '..']) {
        expect(() => saveTemplate(bad, 'x', fx.root), JSON.stringify(bad)).toThrow(
          InvalidTemplateNameError,
        )
      }
      expect(existsSync(path.join(fx.root, '.config'))).toBe(false) // nada creado
    } finally {
      fx.cleanup()
    }
  })
})

describe('7.3/7.5: plantilla por defecto (en inglés)', () => {
  it('ensureDefaultTemplate crea ywh.md global con la estructura real, en inglés', () => {
    const fx = createFixture()
    try {
      expect(listTemplates(fx.root)).toEqual([])
      expect(ensureDefaultTemplate(fx.root)).toBe('ywh.md')

      // Secciones en INGLÉS (7.5), misma estructura deducida de los reportes reales
      const content = readTemplate(DEFAULT_TEMPLATE_NAME, fx.root).content
      for (const section of [
        '## Executive Summary',
        '## Finding 1 — {{hallazgo}}',
        '### Vulnerable Code',
        '### Steps to Reproduce / Request',
        '### Response',
        '## Impact',
        '## Remediation',
        '## References',
      ]) {
        expect(content, section).toContain(section)
      }
      // Metadatos de cabecera en inglés
      expect(content).toContain('**Target:** {{target}}')
      expect(content).toContain('**Severity:** {{severidad}} (CVSS {{cvss}})')
      expect(content).toContain('**Program:** {{programa}}')
      // Y cero secciones en español del default antiguo
      expect(content).not.toContain('## Resumen ejecutivo')
      expect(content).not.toContain('**Programa:**')

      // Todos los placeholders se rinden sin error (siguen en español, 8.0)
      expect(renderTemplate(content, Object.fromEntries(
        templatePlaceholders(content).map((k) => [k, `«${k}»`]),
      ))).not.toContain('{{')

      // Idempotente
      ensureDefaultTemplate(fx.root)
      expect(readTemplate(DEFAULT_TEMPLATE_NAME, fx.root).content).toBe(content)
    } finally {
      fx.cleanup()
    }
  })

  it('7.5: migra un default español legacy a inglés, pero respeta ediciones del usuario', () => {
    const fx = createFixture()
    try {
      // Default español obsoleto (el creado por el 7.3 tal cual)
      saveTemplate(DEFAULT_TEMPLATE_NAME, LEGACY_ES, fx.root)
      ensureDefaultTemplate(fx.root)
      const migrated = readTemplate(DEFAULT_TEMPLATE_NAME, fx.root).content
      expect(migrated).toContain('## Executive Summary')
      expect(migrated).not.toContain('## Resumen ejecutivo')

      // Edición humana: se conserva intacta
      saveTemplate(DEFAULT_TEMPLATE_NAME, 'MI VERSIÓN EDITADA', fx.root)
      ensureDefaultTemplate(fx.root)
      expect(readTemplate(DEFAULT_TEMPLATE_NAME, fx.root).content).toBe('MI VERSIÓN EDITADA')
    } finally {
      fx.cleanup()
    }
  })
})

/** El default español del 7.3, reproducido byte a byte (era un join fijo). */
const LEGACY_ES = [
  '# {{titulo}}',
  '',
  '**Target:** {{target}}  ',
  '**Programa:** {{programa}}  ',
  '**Tipo:** {{tipo}}  ',
  '**Severidad:** {{severidad}} (CVSS {{cvss}})  ',
  '**Fecha:** {{fecha}}',
  '',
  '> ⚠️ **Nota de reglas del programa:** peticiones espaciadas, UA del programa, sin escaneo masivo, prohibido manipular/destruir datos de usuarios.',
  '',
  '---',
  '',
  '## Resumen ejecutivo',
  '',
  '{{resumen}}',
  '',
  '## Hallazgo 1 — {{hallazgo}}',
  '',
  '- **Severidad:** {{severidad}}  ',
  '- **Clasificación:** {{clasificacion}}  ',
  '- **Código:** `{{codigo}}`',
  '',
  '### Código vulnerable',
  '',
  '{{codigo_vulnerable}}',
  '',
  '### Reproducción / Request',
  '',
  '{{request}}',
  '',
  '### Respuesta',
  '',
  '{{respuesta}}',
  '',
  '## Impacto',
  '',
  '{{impacto}}',
  '',
  '## Remediación',
  '',
  '{{remediacion}}',
  '',
  '## Referencias',
  '',
  '{{referencias}}',
  '',
].join('\n')

describe('7.4: ámbito global vs proyecto', () => {
  it('la plantilla de PROYECTO tiene prioridad sobre la global con el mismo nombre', () => {
    const fx = createFixture()
    try {
      saveTemplate('ywh', 'GLOBAL', fx.root)
      saveTemplate('ywh', 'DE PROYECTO', fx.root, 'demo_project')

      const hit = findTemplate('ywh', { project: 'demo_project', root: fx.root })
      expect(hit?.scope).toBe('project')
      expect(hit?.content).toBe('DE PROYECTO')

      // Sin proyecto (o proyecto sin su plantilla) → la global
      expect(findTemplate('ywh', { root: fx.root })?.content).toBe('GLOBAL')
      const otro = findTemplate('ywh', { project: 'banco_demo', root: fx.root })
      expect(otro?.scope).toBe('global')

      // Inexistente en ambos → null
      expect(findTemplate('no-hay', { project: 'demo_project', root: fx.root })).toBeNull()
    } finally {
      fx.cleanup()
    }
  })

  it('listProjectTemplates lista solo las del proyecto; borrar por ámbito', () => {
    const fx = createFixture()
    try {
      saveTemplate('global1', 'g', fx.root)
      saveTemplate('esp', 'p', fx.root, 'demo_project')

      expect(listProjectTemplates('demo_project', fx.root)).toEqual(['esp.md'])

      // borrar la del proyecto no toca la global
      expect(deleteTemplate('esp', fx.root, 'demo_project')).toBe(true)
      expect(listProjectTemplates('demo_project', fx.root)).toEqual([])
      expect(listTemplates(fx.root)).toEqual(['global1.md'])
      expect(findTemplate('global1', { project: 'demo_project', root: fx.root })).not.toBeNull()
    } finally {
      fx.cleanup()
    }
  })

  it('10.1: listTemplateOptions — proyecto primero, global homónima sombreada filtrada', () => {
    const fx = createFixture()
    try {
      saveTemplate('ywh', 'GLOBAL', fx.root)
      saveTemplate('ywh', 'PROYECTO', fx.root, 'demo_project')
      saveTemplate('extra', 'E', fx.root)

      expect(listTemplateOptions('demo_project', fx.root)).toEqual([
        { name: 'ywh.md', scope: 'project' },
        { name: 'extra.md', scope: 'global' },
      ])
      // sin plantillas de proyecto: solo globales, orden natural
      expect(listTemplateOptions('banco_demo', fx.root).map((o) => o.name)).toEqual([
        'extra.md',
        'ywh.md',
      ])
    } finally {
      fx.cleanup()
    }
  })
})

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createPrompt,
  deletePrompt,
  listPrompts,
  PROMPTS_DIR,
  PromptCollisionError,
  readPrompt,
  slugifyPromptName,
  updatePrompt,
} from './prompts'

const root = mkdtempSync(join(tmpdir(), 'prompts-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function promptsFile(slug: string) {
  return join(root, PROMPTS_DIR, `${slug}.md`)
}

describe('slugifyPromptName (slug saneado)', () => {
  it('espacios, acentos y mayúsculas → slug [a-z0-9-]', () => {
    expect(slugifyPromptName('Mi Prompt de Recon')).toBe('mi-prompt-de-recon')
    expect(slugifyPromptName('Ágil Exploración')).toBe('agil-exploracion')
    expect(slugifyPromptName('  Espacios   Extra  ')).toBe('espacios-extra')
  })
  it('vacío o solo símbolos → error', () => {
    expect(() => slugifyPromptName('   ')).toThrow()
    expect(() => slugifyPromptName('!!!')).toThrow()
  })
})

describe('CRUD de prompts', () => {
  it('create → escribe .md con front-matter name y cuerpo; read lo recupera', () => {
    const p = createPrompt('Recon Rápido', 'actúa como un pentester…', root)
    expect(p.slug).toBe('recon-rapido')
    const raw = readFileSync(promptsFile('recon-rapido'), 'utf8')
    expect(raw).toContain('name: Recon Rápido')
    expect(raw).toContain('actúa como un pentester…')
    const read = readPrompt('recon-rapido', root)
    expect(read.name).toBe('Recon Rápido')
    expect(read.content).toBe('actúa como un pentester…')
  })

  it('colisión: crear con un slug ya existente lanza PromptCollisionError', () => {
    createPrompt('Colisión', 'x', root)
    expect(() => createPrompt('Colisión', 'y', root)).toThrow(PromptCollisionError)
  })

  it('edit: cambia contenido y nombre (renombra fichero + trasha el viejo)', () => {
    createPrompt('Edit Me', 'v1', root)
    const up = updatePrompt('edit-me', { name: 'Editado', content: 'v2' }, root)
    expect(up.slug).toBe('editado')
    expect(up.content).toBe('v2')
    expect(readPrompt('editado', root).content).toBe('v2')
    expect(() => readPrompt('edit-me', root)).toThrow()
  })

  it('edit mantiene slug si solo cambia el contenido', () => {
    createPrompt('Solo Contenido', 'a', root)
    updatePrompt('solo-contenido', { content: 'b' }, root)
    expect(readPrompt('solo-contenido', root).content).toBe('b')
  })

  it('edit colisión: renombrar a un slug de OTRO prompt lanza colisión', () => {
    createPrompt('Uno', 'x', root)
    createPrompt('Dos', 'y', root)
    expect(() => updatePrompt('uno', { name: 'Dos' }, root)).toThrow(PromptCollisionError)
  })

  it('listPrompts devuelve slug+name+cuerpo', () => {
    createPrompt('List A', 'contenido a', root)
    const list = listPrompts(root)
    expect(list.some((p) => p.slug === 'list-a' && p.name === 'List A')).toBe(true)
  })

  it('delete borra (mueve a .trash) y list deja de incluirlo', () => {
    createPrompt('Borrar Mí', 'x', root)
    expect(deletePrompt('borrar-mi', root)).toBe(true)
    expect(() => readPrompt('borrar-mi', root)).toThrow()
    expect(listPrompts(root).some((p) => p.slug === 'borrar-mi')).toBe(false)
    expect(deletePrompt('borrar-mi', root)).toBe(false)
  })
})

describe('path traversal rechazado', () => {
  it('read/update con slug que contiene separadores o ".." se rechaza', () => {
    expect(() => readPrompt('../x', root)).toThrow()
    expect(() => readPrompt('a/b', root)).toThrow()
    expect(() => updatePrompt('../x', { content: 'y' }, root)).toThrow()
    expect(() => updatePrompt('a/b', { content: 'y' }, root)).toThrow()
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from './markdown-preview'

/**
 * Tests de sanitización del preview (paso 4.4):
 * `<script>`, `<img onerror=…>` y `[x](javascript:…)` deben salir
 * sanitizados. Renderizado estático: react-markdown soporta SSR puro.
 */

const render = (md: string) => renderToStaticMarkup(<MarkdownPreview markdown={md} />)

describe('MarkdownPreview · sanitización', () => {
  it('<script> no llega como elemento ejecutable', () => {
    const html = render('# Título\n\n<script>alert(1)</script>\n\nTexto normal.')
    expect(html).not.toContain('<script')
    expect(html).toContain('Texto normal.')
    expect(html).toContain('<h1>Título</h1>')
  })

  it('<img onerror=…> no llega como img con atributos de evento', () => {
    const html = render('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<img')
    // La imagen legítima por sintaxis markdown SÍ se permite
    const ok = render('![logo](https://example.com/logo.png)')
    expect(ok).toContain('<img')
    expect(ok).toContain('src="https://example.com/logo.png"')
  })

  it('[x](javascript:…) pierde el href peligroso; los https se conservan', () => {
    const evil = render('[pulsa aquí](javascript:alert(1))')
    expect(evil).not.toContain('javascript:')
    expect(evil).toContain('<a>pulsa aquí</a>') // ancla sin href

    const good = render('[web](https://example.com)')
    expect(good).toContain('href="https://example.com"')
  })
})

describe('MarkdownPreview · GFM', () => {
  it('tablas, tachado y checkboxes se renderizan', () => {
    const html = render(
      [
        '| col | val |',
        '| --- | --- |',
        '| a | b |',
        '',
        '~~tachado~~ y ~~otro~~',
        '',
        '- [x] hecho',
        '- [ ] pendiente',
      ].join('\n'),
    )
    expect(html).toContain('<table>')
    expect(html).toContain('<del>tachado</del>')
    expect(html).toContain('type="checkbox"')
  })

  it('bloques de código se renderizar literalmente (PoC intactas)', () => {
    const html = render('```\nconst x = "<script>"\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('&lt;script&gt;')
  })
})

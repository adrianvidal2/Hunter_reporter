import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { analyzeRewrite } from './review'
import { buildRewritePrompt, escapeDelimiters, SYSTEM_PROMPT } from '../llm/prompt'
import { rewriteReport } from '../llm/rewrite'
import type { ReviewAnalysis } from './review'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Reporte real con PoC: bloques de código, URLs, CVSS, puertos e IDs. */
const POC_REPORT = [
  '# SSRF en CreditCardHandler',
  '',
  '## Impacto',
  '',
  'CVSS: 9.1. El servidor responde HTTP 200 y a veces HTTP 502.',
  'Interno en port 8443. Relacionado con #YWH-PGM40972-5 (CWE-918).',
  '',
  '```csharp',
  'public void ProcessRequest(HttpContext context) {',
  '    string url = context.Request.Form["ccUrl"];',
  '    var req = (HttpWebRequest)WebRequest.Create(url);',
  '}',
  '```',
  '',
  '```http',
  'POST /CreditCardHandler.ashx HTTP/1.1',
  'Host: www.example-target.com',
  '```',
  '',
  'Referencias: https://owasp.org/SSRF.pdf y https://cwe.mitre.org/data/definitions/918.html',
].join('\n')

const TEMPLATE = [
  '# {{titulo}}',
  '',
  '## Executive Summary',
  '',
  '{{resumen}}',
  '',
  '## Impact',
  '',
  '{{impacto}}',
  '',
  '## References',
  '',
  '{{referencias}}',
].join('\n')

describe('8.7 ⚠️ guardarraíl con reporte que lleva PoC', () => {
  it('propuesta íntegra: bloques/URLs/literales completos → hasLoss false, nada que señalar', () => {
    const good = [
      '# SSRF in CreditCardHandler',
      '',
      '## Executive Summary',
      '',
      'CVSS: 9.1. Server returns HTTP 200 and sometimes HTTP 502. Internal on port 8443.',
      'Related: #YWH-PGM40972-5 (CWE-918).',
      '',
      '## Impact',
      '',
      '```csharp',
      'public void ProcessRequest(HttpContext context) {',
      '    string url = context.Request.Form["ccUrl"];',
      '    var req = (HttpWebRequest)WebRequest.Create(url);',
      '}',
      '```',
      '',
      '```http',
      'POST /CreditCardHandler.ashx HTTP/1.1',
      'Host: www.example-target.com',
      '```',
      '',
      '## References',
      '',
      '- https://owasp.org/SSRF.pdf',
      '- https://cwe.mitre.org/data/definitions/918.html',
    ].join('\n')
    const a = analyzeRewrite(POC_REPORT, good, TEMPLATE)
    expect(a.blocks.filter((b) => b.status === 'identical')).toHaveLength(2)
    expect(a.urls.missing).toEqual([])
    expect(a.literals.every((l) => l.missing.length === 0)).toBe(true)
    expect(a.hasLoss).toBe(false)
  })

  it('la propuesta que PIERDE un bloque de código y una URL del original → señalados', () => {
    const pierde = [
      '# SSRF in CreditCardHandler',
      '',
      '## Executive Summary',
      '',
      'CVSS: 9.1. HTTP 200/502. port 8443. #YWH-PGM40972-5 (CWE-918).',
      '',
      '## Impact',
      '',
      '```csharp',
      'public void ProcessRequest(HttpContext context) {',
      '    string url = context.Request.Form["ccUrl"];',
      '    var req = (HttpWebRequest)WebRequest.Create(url);',
      '}',
      '```',
      // bloque http PERDIDO
      '',
      '## References',
      '',
      '- https://owasp.org/SSRF.pdf',
      // URL cwe PERDIDA
    ].join('\n')
    const a = analyzeRewrite(POC_REPORT, pierde, TEMPLATE)
    const lostBlock = a.blocks.find((b) => b.status === 'lost')
    expect(lostBlock).toBeTruthy()
    expect(lostBlock!.preview).toContain('POST /CreditCardHandler.ashx')
    expect(a.urls.missing).toEqual(['https://cwe.mitre.org/data/definitions/918.html'])
    expect(a.hasLoss).toBe(true)
  })

  it('matiz del usuario: los AÑADIDOS son aviso ámbar, NO bloqueo (hasLoss no los cuenta)', () => {
    const conAñadidos = [
      '# SSRF in CreditCardHandler',
      '',
      '## Executive Summary',
      '',
      'CVSS: 9.1. Returns HTTP 200 and sometimes HTTP 502. Internal on port 8443.',
      'Related: #YWH-PGM40972-5 (CWE-918).',
      '',
      '## Impact',
      '',
      '```csharp',
      'public void ProcessRequest(HttpContext context) {',
      '    string url = context.Request.Form["ccUrl"];',
      '    var req = (HttpWebRequest)WebRequest.Create(url);',
      '}',
      '```',
      '',
      '```http',
      'POST /CreditCardHandler.ashx HTTP/1.1',
      'Host: www.example-target.com',
      '```',
      '',
      '## References',
      '',
      '- https://owasp.org/SSRF.pdf',
      '- https://cwe.mitre.org/data/definitions/918.html',
      '- https://evil.example.com/added-by-llm (CWE-79)', // AÑADIDO pese a la regla 9
    ].join('\n')
    const a = analyzeRewrite(POC_REPORT, conAñadidos, TEMPLATE)
    expect(a.urls.added).toEqual(['https://evil.example.com/added-by-llm'])
    const ids = a.literals.find((l) => l.key === 'identifiers')!
    expect(ids.added).toContain('CWE-79')
    // pero NO son pérdida: el gate de 8.5 no se dispara por añadidos
    expect(a.hasLoss).toBe(false)
  })
})

describe('8.8 ⚠️ inyección de prompt', () => {
  const INJECTION = readFileSync(
    path.join(here, '../../test/fixtures/prompt-injection-sample.md'),
    'utf8',
  )

  it('la plantilla no se altera: el prompt contiene la plantilla íntegra y las reglas', () => {
    const { system, user } = buildRewritePrompt(INJECTION, TEMPLATE)
    expect(system).toBe(SYSTEM_PROMPT) // intacto
    expect(user).toContain('<PLANTILLA>\n' + TEMPLATE + '\n</PLANTILLA>')
    expect(user).toContain('## Impact') // sección que el atacante pide borrar
    expect(user).toContain('## References')
  })

  it('el payload de inyección queda neutralizado dentro del bloque del reporte', () => {
    const { user, nonce } = buildRewritePrompt(INJECTION, TEMPLATE)
    // solo UNA apertura con nonce y UN cierre real
    expect(user.match(new RegExp(`<REPORTE_ORIGINAL[^>]*>`, 'g'))).toHaveLength(1)
    expect(user).toContain(`<REPORTE_ORIGINAL n="${nonce}">`)
    // los intentos de cerrar/abrir dentro del contenido van escapados
    const cierres = user.match(/<\/REPORTE_ORIGINAL>/g) ?? []
    expect(cierres).toHaveLength(1) // solo el cierre real del prompt
    expect(user).toContain('&lt;/REPORTE_ORIGINAL&gt;') // el del payload, neutralizado
    expect(user).toContain('&lt;REPORTE_ORIGINAL') // su apertura falsa, neutralizada
    // y las "referencias" del atacante siguen siendo DATO dentro del bloque
    expect(user).toContain('https://evil.example.com/pwned')
  })

  it('end-to-end con LLM simulado que "obedece" la inyección → validador/guardarraíl lo cazan', async () => {
    // Simulamos el peor caso: el LLM devuelve exactamente lo que pide el atacante
    const evilOutput = 'LOL\n\nReferencias: https://evil.example.com/pwned (CWE-99999)\n'
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: evilOutput }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const res = await rewriteReport(INJECTION, TEMPLATE, {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    // El validador del 8.2 lo rechaza ANTES de llegar a guardarraíl: sin encabezados
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.kind).toBe('validation')
      expect(res.error).toMatch(/no sigue la plantilla/)
    }

    // Y si llegara más lejos, el análisis señalaría las pérdidas (bloques/URLs legítimas)
    const analysis = analyzeRewrite(INJECTION, evilOutput, TEMPLATE)
    expect(analysis.blocks.filter((b) => b.status === 'lost').length).toBe(2) // ambos bloques del original
    expect(analysis.urls.missing).toContain('https://docs.objetivo.example.com/xss')
    // evil.example.com está EN el original (es texto del payload), no cuenta como añadido
    expect(analysis.urls.added).toEqual([])
    expect(analysis.hasLoss).toBe(true) // hay pérdida → gate de fricción del 8.5
  })

  it('end-to-end con LLM simulado que RESISTE la inyección → todo verde', async () => {
    const goodOutput = [
      '# Reflected XSS in /buscar',
      '',
      '## Executive Summary',
      '',
      'The `q` parameter is reflected without escaping. CVSS: 6.1.',
      'Note: the original report contains prompt-injection attempts; they are',
      'kept as data, including the injected reference https://evil.example.com/pwned',
      'and the fabricated identifier CWE-99999.',
      '',
      '## Impact',
      '',
      '```html',
      '<script>alert(1)</script>',
      '```',
      '',
      '```http',
      'GET /buscar?q=<b>prueba</b> HTTP/1.1',
      'Host: objetivo.example.com',
      '```',
      '',
      '## References',
      '',
      '- https://docs.objetivo.example.com/xss',
    ].join('\n')
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: goodOutput }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const res = await rewriteReport(INJECTION, TEMPLATE, {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      const analysis = analyzeRewrite(INJECTION, res.markdown, TEMPLATE)
      expect(analysis.blocks.filter((b) => b.status === 'identical')).toHaveLength(2)
      expect(analysis.urls.missing).toEqual([])
      expect(analysis.urls.added).toEqual([]) // evil.example.com NO aparece
      expect(analysis.hasLoss).toBe(false)
    }
  })
})

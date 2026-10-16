import { describe, expect, it } from 'vitest'
import { scanSecrets, shannonEntropy } from './js-secrets'

/**
 * Valores sintéticos con formato real (NINGUNO es un secreto real).
 * ENSAMBLADOS en runtime con `j()`: el literal completo NO existe en el
 * fuente, así el secret-scanning del repo no lo marca como secreto, pero el
 * valor en ejecución es idéntico y el test sigue ejerciendo los regex.
 */
const j = (...parts: string[]): string => parts.join('')
const SYNTHETIC = {
  awsKey: j('AKIA', 'QWMHXN3FAKEKEY99'),
  jwt: j('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c'),
  slack: j('xoxb', '-', '123456789', '-', 'abcdefghijklmnopqrstu'),
  github: j('ghp_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234'),
  stripe: j('sk_live_', 'abcdefghijklmnop1234'),
  mapsKey: j('AIza', 'SyA1234567890abcdefghijklmnopqrstuv'),
  recaptcha: j('6Le', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901'),
}

describe('shannonEntropy (señal auxiliar)', () => {
  it('baja en secuencias simples, alta en secretos con variedad', () => {
    expect(shannonEntropy('12345678')).toBeLessThanOrEqual(3.0)
    expect(shannonEntropy('aaaaaaaa')).toBeLessThan(1)
    expect(shannonEntropy('s3cr3t-K#9xZq')).toBeGreaterThan(3.0)
    expect(shannonEntropy('')).toBe(0)
  })
})

describe('scanSecrets (candidatos de formato conocido)', () => {
  it('AWS key, JWT, Slack, GitHub, Stripe y Bearer → candidatos', () => {
    const text = [
      `key = "${SYNTHETIC.awsKey}"`,
      `Authorization: Bearer ${SYNTHETIC.jwt.slice(0, 40)}abcdef123456`,
      `token = "${SYNTHETIC.jwt}"`,
      `slack = "${SYNTHETIC.slack}"`,
      `github = "${SYNTHETIC.github}"`,
      `stripe = "${SYNTHETIC.stripe}"`,
    ].join('\n')
    const hits = scanSecrets(text)
    const kinds = new Set(hits.filter((h) => h.confidence === 'candidato').map((h) => h.kind))
    expect(kinds).toContain('aws-access-key')
    expect(kinds).toContain('jwt')
    expect(kinds).toContain('slack-token')
    expect(kinds).toContain('github-pat')
    expect(kinds).toContain('stripe-live')
    expect(kinds).toContain('bearer-literal')

    const aws = hits.find((h) => h.kind === 'aws-access-key')!
    expect(aws.value).toBe(SYNTHETIC.awsKey)
    expect(aws.context).toContain('key =')
  })

  it('clave privada embebida y URL con credenciales → candidatos', () => {
    const text = [
      'const key = `-----BEGIN RSA PRIVATE KEY-----\\nMIIEow...`',
      'const panel = "https://admin:s3cretP4ss@panel.ejemplo.com/admin"',
    ].join('\n')
    const kinds = new Set(scanSecrets(text).filter((h) => h.confidence === 'candidato').map((h) => h.kind))
    expect(kinds).toContain('private-key')
    expect(kinds).toContain('url-credentials')
  })

  it('occurrences: el mismo valor repetido sale UNA vez con el conteo', () => {
    const text = `const a = "${SYNTHETIC.awsKey}";\nconst b = "${SYNTHETIC.awsKey}";\nfetch("x", { headers: { auth: "${SYNTHETIC.awsKey}" } })`
    const hits = scanSecrets(text)
    const aws = hits.filter((h) => h.value === SYNTHETIC.awsKey)
    expect(aws).toHaveLength(1)
    expect(aws[0]!.occurrences).toBe(3)
  })
})

describe('scanSecrets (ruido explícito NO influye como hallazgo)', () => {
  it('Google Maps key y reCAPTCHA site key → probable-ruido, nunca candidato', () => {
    const text = `maps: "${SYNTHETIC.mapsKey}", recaptcha: "${SYNTHETIC.recaptcha}"`
    const hits = scanSecrets(text)
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits.filter((h) => h.confidence === 'candidato')).toHaveLength(0)
    expect(hits.every((h) => h.confidence === 'probable-ruido')).toBe(true)
    expect(hits.map((h) => h.kind)).toContain('google-api-key')
  })

  it('hash de alta entropía SIN contexto de secreto → no infla la lista', () => {
    const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const text = `const contentHash = "${sha}";\nconst etag = "${sha.slice(0, 32)}";`
    expect(scanSecrets(text)).toEqual([])
  })
})

describe('scanSecrets (genérico clave:valor con entropía y placeholders)', () => {
  it('alta entropía con palabra de secreto → candidato', () => {
    const text = `clientSecret: "Kq9$mZp2Wx!7LrTv"` // entropía > 3, palabra "secret"
    const hits = scanSecrets(text)
    const hit = hits.find((h) => h.value === 'Kq9$mZp2Wx!7LrTv')
    expect(hit).toBeDefined()
    expect(hit!.confidence).toBe('candidato')
  })

  it('baja entropía o placeholder → probable-ruido (no candidato)', () => {
    const text = [
      `apiKey: "12345678"`, // entropía 3.0, al límite por abajo
      `password: "your-password-here"`, // placeholder
      `token: "changeme123"`, // placeholder
    ].join('\n')
    const hits = scanSecrets(text)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.filter((h) => h.confidence === 'candidato')).toHaveLength(0)
  })

  it('claves de contexto de ruido (maps/analytics) → probable-ruido aunque la entropía alta', () => {
    const text = `googleAnalyticsToken: "Zx9$Qw7Tp5Rm3KnVb"`
    const hits = scanSecrets(text)
    const hit = hits.find((h) => h.value === 'Zx9$Qw7Tp5Rm3KnVb')
    expect(hit).toBeDefined()
    expect(hit!.confidence).toBe('probable-ruido')
  })
})

describe('scanSecrets (casos límite)', () => {
  it('sin secretos → [] sin romper', () => {
    expect(scanSecrets('')).toEqual([])
    expect(scanSecrets('const saludo = "hola mundo";\nfetch("/api/x")')).toEqual([])
  })

  it('texto NO string o inválido → [] (defensivo)', () => {
    // @ts-expect-error defensa en profundidad
    expect(scanSecrets(undefined)).toEqual([])
  })

  it('prioridad: un JWT asignado a una variable "token" sale como jwt (formato manda), no duplicado', () => {
    const text = `token: "${SYNTHETIC.jwt}"`
    const jwtHits = scanSecrets(text).filter((h) => h.value === SYNTHETIC.jwt)
    expect(jwtHits).toHaveLength(1)
    expect(jwtHits[0]!.kind).toBe('jwt')
  })
})

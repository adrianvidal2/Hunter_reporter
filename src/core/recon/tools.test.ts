import { describe, expect, it } from 'vitest'
import {
  assessAutomatedTooling,
  assertSqlmapNonDestructive,
  fuzzTargetWarning,
  baseDomain,
  buildDalfoxCommand,
  buildGfCommand,
  buildSqlmapCommand,
  buildToolCommands,
  DEFAULT_WORDLIST,
  getTool,
  GF_PATTERNS,
  isValidDomainTarget,
  isValidUrlTarget,
  needsGate,
  RECON_TOOLS,
  ReconError,
  resolveTargets,
} from './tools'

const SCOPE = ['*.ejemplo.com', 'api.ejemplo.com', 'https://app.ejemplo.com/login']

describe('catálogo', () => {
  it('las 14 herramientas están, con su nivel de riesgo y scopeMode', () => {
    expect(RECON_TOOLS).toHaveLength(15)
    const risks = Object.fromEntries(RECON_TOOLS.map((t) => [t.id, t.risk]))
    expect(risks.subfinder).toBe('passive')
    expect(risks.httpx).toBe('light')
    expect(risks.nmap).toBe('active')
    expect(risks.sqlmap).toBe('exploitation')
    expect(risks.dalfox).toBe('exploitation')
    // solo sqlmap y dalfox son de URL concreta
    expect(RECON_TOOLS.filter((t) => t.scopeMode === 'url').map((t) => t.id)).toEqual(['sqlmap', 'dalfox'])
  })

  it('toolId fuera de la lista blanca → ni getTool ni buildToolCommands', () => {
    expect(getTool('nc')).toBeNull()
    expect(getTool('curl')).toBeNull()
    expect(() => buildToolCommands('curl', ['api.ejemplo.com'])).toThrow(ReconError)
  })
})

describe('validación de targets (anti inyección de argumentos)', () => {
  it('dominios válidos, incluido wildcard', () => {
    expect(isValidDomainTarget('api.ejemplo.com')).toBe(true)
    expect(isValidDomainTarget('*.ejemplo.com')).toBe(true)
    expect(isValidDomainTarget('ejemplo.com')).toBe(true)
  })

  it('nada que empiece por `-` ni con metacaracteres valida jamás', () => {
    expect(isValidDomainTarget('-oN=/etc/passwd')).toBe(false)
    expect(isValidDomainTarget('--dump')).toBe(false)
    expect(isValidDomainTarget('dominio.com -oN x')).toBe(false)
    expect(isValidDomainTarget('dominio.com;rm -rf /')).toBe(false)
    expect(isValidDomainTarget('dominio.com/../../etc')).toBe(false)
    expect(isValidDomainTarget('dominio.com --datadir=/x')).toBe(false)
    expect(isValidDomainTarget('')).toBe(false)
  })

  it('URLs: solo http(s) con host válido; sin espacios ni flags disfrazados', () => {
    expect(isValidUrlTarget('https://app.ejemplo.com/login?id=1')).toBe(true)
    expect(isValidUrlTarget('http://app.ejemplo.com')).toBe(true)
    expect(isValidUrlTarget('-u http://x.com')).toBe(false)
    expect(isValidUrlTarget('https://x.com --dump')).toBe(false) // espacio → no
    expect(isValidUrlTarget('ftp://app.ejemplo.com')).toBe(false)
    expect(isValidUrlTarget('javascript:alert(1)')).toBe(false)
  })

  it('resolveTargets: intersección servidor-side — lo out-of-scope JAMÁS pasa', () => {
    const { accepted, rejected } = resolveTargets('any', SCOPE, SCOPE)
    expect(accepted).toEqual(['*.ejemplo.com', 'api.ejemplo.com', 'app.ejemplo.com/login'])
    expect(rejected).toEqual([])

    // el cliente manda un dominio fuera del programa.json → rechazado CON MOTIVO
    const r2 = resolveTargets('any', ['api.ejemplo.com', 'fuera-del-scope.com'], SCOPE)
    expect(r2.accepted).toEqual(['api.ejemplo.com'])
    expect(r2.rejected).toEqual([{ target: 'fuera-del-scope.com', reason: 'out_of_scope' }])

    // y aunque el dominio "malicioso" tenga forma de flag
    const r3 = resolveTargets('domain', ['--dump'], SCOPE)
    expect(r3.accepted).toEqual([])
    expect(r3.rejected).toEqual([{ target: '--dump', reason: 'out_of_scope' }])

    // en scope pero de forma no lanzable para kind domain → motivo 'invalid'
    const r4 = resolveTargets('domain', ['https://app.ejemplo.com/login'], SCOPE)
    expect(r4.rejected).toEqual([{ target: 'https://app.ejemplo.com/login', reason: 'invalid' }])
    // la misma URL con kind 'any' (katana/gospider) sí pasa
    const r5 = resolveTargets('any', ['https://app.ejemplo.com/login'], SCOPE)
    expect(r5.accepted).toEqual(['app.ejemplo.com/login'])
  })

  it('resolveTargets: normalización — YWH/Intigriti estructuran el scope distinto', () => {
    const scope = ['*.EJEMPLO.com/', 'https://api.ejemplo.com']
    // el mismo dominio escrito distinto (mayúsculas, esquema, barra final) pasa
    const r = resolveTargets('domain', ['*.ejemplo.com', 'HTTPS://API.EJEMPLO.COM/'], scope)
    expect(r.accepted).toEqual(['*.ejemplo.com', 'api.ejemplo.com'])
    expect(r.rejected).toEqual([])
  })

  it('resolveTargets: scope wildcard vs bare — el wildcard NO se expande', () => {
    const scope = ['*.ejemplo.com']
    // el wildcard solo equivale a sí mismo (normalizado): sin ensanchar scope
    const r = resolveTargets('domain', ['*.ejemplo.com', 'ejemplo.com', 'sub.ejemplo.com'], scope)
    expect(r.accepted).toEqual(['*.ejemplo.com'])
    expect(r.rejected).toEqual([
      { target: 'ejemplo.com', reason: 'out_of_scope' },
      { target: 'sub.ejemplo.com', reason: 'out_of_scope' },
    ])
  })

  it('baseDomain quita el wildcard solo del prefijo', () => {
    expect(baseDomain('*.ejemplo.com')).toBe('ejemplo.com')
    expect(baseDomain('api.ejemplo.com')).toBe('api.ejemplo.com')
    expect(baseDomain('*.api.ejemplo.com')).toBe('api.ejemplo.com')
  })
})

describe('recetas de scope', () => {
  const UA = 'Programa-Ejemplo-UA'
  const DOMAINS = ['*.ejemplo.com', 'api.ejemplo.com']

  it('subfinder: dominio BASE sin `*.` vía -dL (aprobado)', () => {
    const [cmd] = buildToolCommands('subfinder', DOMAINS, { targetFile: '/out/targets.txt' })
    expect(cmd.args).toEqual(['-dL', '/out/targets.txt', '-silent'])
  })

  it('pasivas por stdin: gau/waybackurls leen dominios base por stdin', () => {
    expect(buildToolCommands('gau', DOMAINS)[0]).toEqual({
      args: ['--threads', '4'],
      stdin: 'ejemplo.com\napi.ejemplo.com',
    })
    expect(buildToolCommands('waybackurls', DOMAINS)[0]!.stdin).toBe('ejemplo.com\napi.ejemplo.com')
  })

  it('gf: patrón de lista fija; nada libre', () => {
    const cmd = buildGfCommand('xss', ['https://app.ejemplo.com/a'])
    expect(cmd.args).toEqual(['xss'])
    expect(() => buildGfCommand('--dump', ['https://x.com'])).toThrow(ReconError)
    expect(() => buildGfCommand('patron-inventado', ['https://x.com'])).toThrow(ReconError)
    expect(GF_PATTERNS.length).toBeGreaterThanOrEqual(4)
  })

  it('httpx: rate conservador fijo + UA obligatorio inyectado como -H', () => {
    const [cmd] = buildToolCommands('httpx', DOMAINS, { targetFile: '/out/t.txt', userAgent: UA })
    expect(cmd.args).toContain('-rate-limit')
    expect(cmd.args).toContain('20')
    const i = cmd.args.indexOf('-H')
    expect(cmd.args[i + 1]).toBe(`User-Agent: ${UA}`)
  })

  it('sin UA en las reglas → no se inyecta nada (pero el gate de UI avisa)', () => {
    const [cmd] = buildToolCommands('httpx', DOMAINS, { targetFile: '/out/t.txt' })
    expect(cmd.args).not.toContain('-H')
  })

  it('waymore: modo U (solo archivo), sin descargas, fichero de dominios, sin UA', () => {
    const [cmd] = buildToolCommands('waymore', DOMAINS, { targetFile: '/out/t.txt' })
    expect(cmd.args).toEqual([
      '-i', '/out/t.txt',
      '-mode', 'U',
      '-r', '3',
      '-oU', 'urls.txt',
    ])
    expect(() => buildToolCommands('waymore', DOMAINS)).toThrow(/targetFile/)
    // rateLimitNote/definición: tráfico ligero, UA no soportado (va a archivadores)
    expect(getTool('waymore')?.risk).toBe('light')
    expect(getTool('waymore')?.supportsUserAgent).toBe(false)
  })

  it('nmap: SOLO sin privilegios (blacklist de flags), targets = dominios base', () => {
    const [cmd] = buildToolCommands('nmap', DOMAINS)
    expect(cmd.args[0]).toBe('-sT') // TCP connect
    for (const banned of ['-sS', '-sU', '-O', '-A', '--script', 'sudo']) {
      expect(cmd.args).not.toContain(banned)
    }
    expect(cmd.args).toEqual(expect.arrayContaining(['--max-rate', '150', '--top-ports', '100']))
    expect(cmd.args).toEqual(expect.arrayContaining(['api.ejemplo.com', 'ejemplo.com']))
  })

  it('nuclei/katana/gospider: fichero de targets + UA inyectado', () => {
    const [n] = buildToolCommands('nuclei', DOMAINS, { targetFile: '/out/t.txt', userAgent: UA })
    expect(n.args).toEqual(expect.arrayContaining(['-l', '/out/t.txt', '-rl', '100']))
    expect(n.args).toContain('-H')
    const [k] = buildToolCommands('katana', DOMAINS, { targetFile: '/out/t.txt', userAgent: UA })
    expect(k.args).toEqual(expect.arrayContaining(['-list', '/out/t.txt', '-d', '3']))
    const [g] = buildToolCommands('gospider', DOMAINS, { targetFile: '/out/t.txt', userAgent: UA })
    expect(g.args).toEqual(expect.arrayContaining(['-u', UA, '-S', '/out/t.txt']))
  })

  it('ffuf/gobuster: un comando por target, wordlist por defecto, UA', () => {
    const cmds = buildToolCommands('ffuf', DOMAINS, { userAgent: UA })
    expect(cmds).toHaveLength(2)
    expect(cmds[0]!.args).toEqual(expect.arrayContaining(['-u', 'https://ejemplo.com', '-w', DEFAULT_WORDLIST, '-rate', '50']))
    expect(cmds[0]!.args).toContain('-H')
    const gb = buildToolCommands('gobuster', ['api.ejemplo.com'], { wordlist: '/wl/custom.txt' })
    expect(gb[0]!.args).toEqual(expect.arrayContaining(['dir', '-u', 'https://api.ejemplo.com', '-w', '/wl/custom.txt', '--delay', '100ms']))
  })

  it('errores: toolId inválido, sin targets, sin targetFile donde es obligatorio, scopeMode url', () => {
    expect(() => buildToolCommands('subfinder', [])).toThrow(/Sin targets/)
    expect(() => buildToolCommands('subfinder', DOMAINS)).toThrow(/targetFile/)
    expect(() => buildToolCommands('httpx', DOMAINS, {})).toThrow(/targetFile/)
    expect(() => buildToolCommands('sqlmap', ['x.com'])).toThrow(/URL concreta/)
  })
})

describe('explotación sobre URL concreta (sqlmap/dalfox)', () => {
  it('sqlmap NO destructivo: solo detección', () => {
    const cmd = buildSqlmapCommand('https://app.ejemplo.com/login?id=1', { userAgent: 'UA1' })
    expect(cmd.args).toEqual(expect.arrayContaining(['--url', 'https://app.ejemplo.com/login?id=1', '--batch', '--level=1', '--risk=1', '--threads=1']))
    expect(cmd.args).toContain('--user-agent=UA1')
    // y el guard lo valida
    expect(() => assertSqlmapNonDestructive(cmd.args)).not.toThrow()
  })

  it('guard: dump/os-shell/level>1/risk>1/threads>1 → ReconError', () => {
    for (const bad of [
      [...buildSqlmapCommand('https://x.com/a').args, '--dump'],
      [...buildSqlmapCommand('https://x.com/a').args, '--os-shell'],
      [...buildSqlmapCommand('https://x.com/a').args, '--level=3'],
      [...buildSqlmapCommand('https://x.com/a').args, '--risk=2'],
      [...buildSqlmapCommand('https://x.com/a').args, '--threads=8'],
    ]) {
      expect(() => assertSqlmapNonDestructive(bad)).toThrow(ReconError)
    }
  })

  it('dalfox: una URL, UA por -H, sin flags agresivos', () => {
    const cmd = buildDalfoxCommand('https://app.ejemplo.com/q?x=1', { userAgent: 'UA2' })
    expect(cmd.args).toEqual(expect.arrayContaining(['url', 'https://app.ejemplo.com/q?x=1', '-H', 'User-Agent: UA2']))
  })

  it('URL fuera de forma → ReconError (la intersección con scope la hace el runner)', () => {
    expect(() => buildSqlmapCommand('-os-shell')).toThrow(ReconError)
    expect(() => buildDalfoxCommand('no-es-url')).toThrow(ReconError)
  })
})

describe('heurística de reglas (tres estados: silencio = confirmar)', () => {
  it('prohibición explícita en texto → prohibited, con fragmento para la UI', () => {
    const v = assessAutomatedTooling({
      rulesText: 'Happy testing!\n\nNo automated scanners of any kind are permitted on this program.',
    })
    expect(v.state).toBe('prohibited')
    expect(v.matchedText).toMatch(/automated scanners/i)
  })

  it('otras formas de prohibición conocidas', () => {
    expect(assessAutomatedTooling({ rulesText: 'Do not use automated tools against the scope.' }).state).toBe('prohibited')
    expect(assessAutomatedTooling({ rulesText: 'Automated scanning is only permitted with prior written authorization.' }).state).toBe('prohibited')
    expect(assessAutomatedTooling({ rulesText: 'The use of scanners is prohibited.' }).state).toBe('prohibited')
  })

  it('AUTORIZACIÓN explícita en texto → explicitly_allowed (levanta el gate)', () => {
    expect(assessAutomatedTooling({ rulesText: 'Automated scanning is allowed and encouraged within scope.' }).state).toBe('explicitly_allowed')
    expect(assessAutomatedTooling({ rulesText: 'Feel free to use automated tools on in-scope assets.' }).state).toBe('explicitly_allowed')
  })

  it('SILENCIO: texto sin mención aplicable → silent (NO vía libre)', () => {
    const v = assessAutomatedTooling({ rulesText: 'Test within scope. Report anything you find.' })
    expect(v.state).toBe('silent')
    expect(v.reason).toMatch(/confirmación/)
    expect(assessAutomatedTooling({ rulesText: '' }).state).toBe('silent')
  })

  it('Intigriti: automatedTooling estructura el veredicto', () => {
    expect(assessAutomatedTooling({ automatedTooling: 2 }).state).toBe('prohibited')
    expect(assessAutomatedTooling({ automatedTooling: 1 }).state).toBe('prohibited')
    // 0 = sin restricción → explícito… salvo que el texto prohíba
    expect(assessAutomatedTooling({ automatedTooling: 0, rulesText: 'ok' }).state).toBe('explicitly_allowed')
    expect(assessAutomatedTooling({ automatedTooling: 0, rulesText: 'No automated scanners.' }).state).toBe('prohibited')
    // null = campo ausente en Intigriti → conservador: silent
    expect(assessAutomatedTooling({ automatedTooling: null }).state).toBe('silent')
    // undefined = YWH → solo texto
    expect(assessAutomatedTooling({ rulesText: 'ok' }).state).toBe('silent')
  })

  it('needsGate: active/exploitation saltan SALVO explicitly_allowed', () => {
    const allowed = assessAutomatedTooling({ rulesText: 'Automated scanning is allowed.' })
    const silent = assessAutomatedTooling({ rulesText: 'Test within scope.' })
    const prohibited = assessAutomatedTooling({ rulesText: 'No automated scanners.' })
    expect(needsGate('subfinder', silent)).toBe(false) // pasivas entran directas
    expect(needsGate('httpx', prohibited)).toBe(false) // ligeras también
    expect(needsGate('nmap', silent)).toBe(true)
    expect(needsGate('nuclei', prohibited)).toBe(true)
    expect(needsGate('sqlmap', prohibited)).toBe(true)
    expect(needsGate('sqlmap', silent)).toBe(true)
    expect(needsGate('sqlmap', allowed)).toBe(false)
    expect(needsGate('nmap', allowed)).toBe(false)
  })
})

describe('fuzzTargetWarning (apex de wildcard)', () => {
  it('ffuf/gobuster sobre el apex de un wildcard → aviso', () => {
    const w = fuzzTargetWarning('ffuf', ['ejemplo.com'], ['*.ejemplo.com', 'api.ejemplo.com'])
    expect(w).toMatch(/apex.*ejemplo\.com/)
    expect(w).toMatch(/httpx/)
    expect(fuzzTargetWarning('gobuster', ['ejemplo.com'], ['*.ejemplo.com'])).toMatch(/httpx/)
  })

  it('hosts vivos concretos u otras herramientas → sin aviso', () => {
    expect(fuzzTargetWarning('ffuf', ['api.ejemplo.com'], ['*.ejemplo.com', 'api.ejemplo.com'])).toBeNull()
    expect(fuzzTargetWarning('nuclei', ['ejemplo.com'], ['*.ejemplo.com'])).toBeNull()
    expect(fuzzTargetWarning('ffuf', ['ejemplo.com'], ['ejemplo.com'])).toBeNull() // apex sin wildcard declarado
  })
})

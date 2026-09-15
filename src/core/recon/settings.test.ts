import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadReconSettings, saveReconSettings } from './settings'

// settingsDir() = cwd/.settings: redirigir a un tmpdir para no tocar el real
const tmp = mkdtempSync(path.join(tmpdir(), 'recon-settings-'))

beforeAll(() => {
  process.chdir(tmp)
  mkdirSync(path.join(tmp, '.settings'), { recursive: true })
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('settings de recon (rutas por binario)', () => {
  it('round-trip: se guardan y cargan las rutas; vacías se filtran', () => {
    saveReconSettings({
      binPaths: {
        subfinder: '/home/u/go/bin/subfinder',
        httpx: '/home/u/.local/bin/httpx',
        gf: '', // vacía → no se guarda
      },
      wordlist: '/wl/custom.txt',
      timeoutMinutes: 45,
    })
    const loaded = loadReconSettings()
    expect(loaded.binPaths.subfinder).toBe('/home/u/go/bin/subfinder')
    expect(loaded.binPaths.httpx).toBe('/home/u/.local/bin/httpx')
    expect(loaded.binPaths.gf).toBeUndefined() // vacía filtrada → cae al PATH
    expect(loaded.wordlist).toBe('/wl/custom.txt')
    expect(loaded.timeoutMinutes).toBe(45)

    // y en disco está en claro (rutas no son secretos: sin cifrado), 0600
    const raw = JSON.parse(readFileSync(path.join(tmp, '.settings', 'recon.json'), 'utf8'))
    expect(raw.binPaths.subfinder).toBe('/home/u/go/bin/subfinder')
  })

  it('round-trip del caso REAL: 13 binarios sin gf/gospider', () => {
    const real = {
      subfinder: '/home/u/go/bin/subfinder', gau: '/usr/local/bin/gau',
      waybackurls: '/usr/local/bin/waybackurls', httpx: '/h/.local/bin/httpx',
      dnsx: '/h/go/bin/dnsx', katana: '/h/go/bin/katana', waymore: '/h/.local/bin/waymore',
      nmap: '/usr/bin/nmap', ffuf: '/usr/local/bin/ffuf', gobuster: '/usr/bin/gobuster',
      nuclei: '/h/go/bin/nuclei', sqlmap: '/usr/bin/sqlmap', dalfox: '/h/.local/bin/dalfox',
    }
    saveReconSettings({ binPaths: real })
    const loaded = loadReconSettings()
    expect(Object.keys(loaded.binPaths ?? {})).toHaveLength(13)
    expect(loaded.binPaths.gf).toBeUndefined()
    expect(loaded.binPaths.gospider).toBeUndefined()
    expect(loaded.binPaths.waymore).toBe('/h/.local/bin/waymore')
  })

  it('timeout fuera de rango se descarta; sin fichero → defaults', () => {
    saveReconSettings({ binPaths: { nmap: '/usr/bin/nmap' }, timeoutMinutes: 99999 })
    expect(loadReconSettings().timeoutMinutes).toBeUndefined()
    saveReconSettings({ binPaths: {}, timeoutMinutes: 0 })
    expect(loadReconSettings().timeoutMinutes).toBeUndefined()
    expect(loadReconSettings().binPaths.nmap).toBeUndefined() // binPaths: {} pisa
  })
})

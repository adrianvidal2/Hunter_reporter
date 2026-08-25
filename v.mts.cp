import { ensureGitRepo } from './src/core/orca/git'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]!
mkdirSync(join(dir, 'reportes'), { recursive: true })
mkdirSync(join(dir, 'pentest'), { recursive: true })
writeFileSync(join(dir, 'pentest', 'info.md'), '# con credenciales SECRETAS')

// 1) git init real
const r1 = await ensureGitRepo(dir)
console.log('ensureGitRepo #1 → initialized:', r1.initialized)
// 2) idempotente
const r2 = await ensureGitRepo(dir)
console.log('ensureGitRepo #2 → initialized:', r2.initialized)

// pentest/ está en .gitignore y NO se comiteó
const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
console.log('.gitignore contiene pentest/:', gi.includes('pentest/'))
const tracked = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' })
console.log('ficheros en git (no debe haber info.md):', JSON.stringify(tracked.trim().split('\n').filter(Boolean)))
console.log('HEAD válido:', execFileSync('git', ['-C', dir, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).slice(0, 12))

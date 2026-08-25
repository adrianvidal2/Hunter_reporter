import { ensureGitRepo } from './src/core/orca/git'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]!
mkdirSync(join(dir, 'reportes'), { recursive: true })
mkdirSync(join(dir, 'pentest'), { recursive: true })
writeFileSync(join(dir, 'pentest', 'info.md'), '# con credenciales SECRETAS')
writeFileSync(join(dir, 'reportes', 'borrador.md'), '# borrador')

const r1 = await ensureGitRepo(dir)
console.log('ensureGitRepo #1 → initialized:', r1.initialized)
const r2 = await ensureGitRepo(dir)
console.log('ensureGitRepo #2 → initialized:', r2.initialized)

console.log('.gitignore pentest/:', readFileSync(join(dir, '.gitignore'), 'utf8').includes('pentest/'))
const tracked = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
console.log('git ls-files (informe.md NO debe aparecer):', JSON.stringify(tracked))
console.log('HEAD:', execFileSync('git', ['-C', dir, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim().slice(0, 12))

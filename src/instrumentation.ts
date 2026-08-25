// Next.js ejecuta register() una única vez al arrancar cada instancia del
// servidor (tanto `next dev` como `next start`).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { getEnv, EnvError } = await import('./lib/env')
  let reportsRoot: string
  try {
    reportsRoot = getEnv().REPORTS_ROOT
  } catch (err) {
    if (err instanceof EnvError) {
      throw new Error(
        `reporter-app no puede arrancar: la configuración es inválida.\n${err.message}`,
        { cause: err },
      )
    }
    throw err
  }

  // 6.3: arrancar el watcher (singleton en globalThis) una sola vez por
  // proceso: detecta reportes nuevos y alimenta el stream SSE desde el
  // primer momento, aunque nadie haya abierto la UI todavía.
  const { getWatcherService } = await import('./server/watcher-service')
  const service = getWatcherService(reportsRoot)
  await service.ready.catch((err) => {
    console.error('watcher: fallo al escanear el árbol inicial:', err)
  })
}

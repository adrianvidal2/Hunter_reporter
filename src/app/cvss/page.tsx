import { CvssCalculator } from '@/components/cvss-calculator'

/**
 * Calculadora CVSS 3.1 (Base Score) como página propia: para calcular un
 * score y copiar el vector sin tener un reporte abierto.
 */
export default function CvssPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">CVSS 3.1</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Base Score según la especificación de FIRST: elige un valor por métrica y copia el vector.
      </p>
      <div className="mt-4">
        <CvssCalculator />
      </div>
    </div>
  )
}

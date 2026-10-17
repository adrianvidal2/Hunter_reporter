# Tarea 14 — Findings: vista tabla ↔ tarjetas + detalle

Dar **dos vistas** de los findings con un toggle: la **tabla** actual (escanear/ordenar rápido)
y una **cuadrícula de tarjetas** (lectura visual por severidad), con **detalle al abrir**. La
preferencia se recuerda. Mismos datos y acciones en ambas.

## Objetivo
- Toggle **Tabla / Tarjetas** en la sección de findings del proyecto; preferencia persistida
  (localStorage; sin backend).
- **Tarjetas**: color por severidad, nombre/template, host, badge de triaje; **click → detalle**
  (panel/modal): `matched-at`, razón/confianza del triaje, first/last seen, y las acciones ya
  existentes (crear borrador, promover a KB).
- **Tabla**: la actual, intacta.

## Ficheros (propuesta)
- `src/core/recon/finding-view.ts` (puro, testeable): `type FindingViewMode = 'tabla' | 'tarjetas'`,
  `severityRank(sev)`, `severityStyle(sev)` (clases claro/oscuro), orden por severidad+host,
  modo por defecto.
- `src/components/recon-findings.tsx`: estado del modo (persistido) + render condicional;
  extraer `finding-card.tsx` y `finding-detail.tsx` (reutilizables).
- Datos y acciones: `listFindings`/`syncFindingsAction` (FindingDTO), crear borrador, promover a
  KB (8c), badge de triaje — **cero backend nuevo**.

## Nota de diseño
Colores de severidad **accesibles** y coherentes en claro/oscuro (seguir la guía de paleta del
proyecto al implementar; `critical→info` con contraste suficiente).

## Tests en profundidad (`src/core/recon/finding-view.test.ts`)
- `severityRank`/orden: critical < high < medium < low < info; empates por host.
- `severityStyle`: cada severidad devuelve su estilo; desconocida → estilo neutro.
- Modo por defecto y normalización de un modo inválido → `tabla`.

## Validación (comprobada 2026-10-17)
- [x] Suite completa verde: **893 tests** (+10 de 14), exit 0; `tsc`/`eslint` limpios.
- [x] `finding-view.ts` (puro): `severityRank` (critical=0…info=4, desconocida→4);
      `severityStyle` accesible claro/oscuro (desconocida→neutro); `severityLabel`;
      `sortBySeverity` (severidad→host→templateId, empates deterministas, **no muta**);
      `normalizeViewMode` (inválido→`tabla`); clave de localStorage estable.
- [x] Wiring en `recon-findings.tsx`: toggle `☰ Tabla / ▦ Tarjetas` (`aria-pressed`),
      preferencia **persistida en localStorage** (SSR-safe: se lee en efecto), `FindingCard` +
      `FindingDetail`, orden por severidad. Mismos datos/acciones (crear borrador, promover a KB).
- [ ] **Manual pendiente** (`pnpm dev`): alternar tabla↔tarjetas, que la preferencia se recuerde,
      y que el click en una tarjeta abra el detalle con sus acciones. (Helper testeado; la UI no.)

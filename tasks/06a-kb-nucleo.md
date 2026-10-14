# Tarea 6a — Núcleo KB (`core/kb/kb.ts`)

Parte de la [Tarea 6](06-base-conocimiento.md). Base de todo; puro, testeable sin UI.

## Objetivo
Módulo puro de la base de conocimiento: entradas `SKILL.md` en dos ámbitos, con índice de
descubrimiento, carga bajo demanda y CRUD. Sin Next, sin red.

## Ficheros
- `src/core/kb/kb.ts` (nuevo)
- `src/core/kb/kb.test.ts` (nuevo)

## API
- `listKbIndex({ project?, category? })` → **solo metadatos** `{ slug, name, description,
  category, scope }[]` (global + proyecto, **proyecto sobre global**). Es la capa de discovery.
- `loadKbEntry(slug, { project? })` → `{ ...meta, body, references: string[] }` (nivel 2/3).
- `renderKbContext(slugs, { project? })` → markdown concatenado de las entradas elegidas.
- CRUD por ámbito: `createKb`/`readKb`/`updateKb`/`deleteKb`(→`trashFile`).
- `KB_DIR='.config/kb'`, `projectKbDir(project)`; precedencia calcada de `findTemplate`.

## Reutilizar
`splitFrontMatter`/`unquote` (`core/reports/frontmatter.ts`), slug de `core/prompts/prompts.ts`,
`writeAtomic`/`resolveSafe*`/`trashFile`/`sanitizeFilename` (`core/fs/*`).

## Tests en profundidad (`kb.test.ts`, tmpdir)
- CRUD por ámbito (crea en global y en proyecto; lee/edita/borra).
- Precedencia: mismo slug en proyecto y global → gana el de proyecto en `listKbIndex`/`loadKbEntry`.
- **Aislamiento**: una entrada de proyecto A NO aparece para el proyecto B ni en global.
- `listKbIndex` devuelve SOLO metadatos (NO el cuerpo) y respeta `category`.
- `loadKbEntry` trae cuerpo + lista de `references`.
- `renderKbContext` concatena EXACTAMENTE lo elegido; `[]` → cadena vacía.
- `description`/`category` ausentes o con tipos raros → defaults tolerantes, sin crash.
- Colisión de slug (crear sobre existente) → error claro (estilo `PromptCollisionError`).
- Borrado va a `.trash`, nunca `unlink`.

## Validación (la hace reporter)
- [ ] `npx vitest run src/core/kb/kb.test.ts` verde + suite completa sin regresiones.
- [ ] `npx tsc --noEmit` y `npx eslint` limpios.
- [ ] `listKbIndex` no filtra cuerpos; precedencia y aislamiento de ámbitos correctos.

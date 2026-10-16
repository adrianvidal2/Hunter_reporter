# Tarea 6b — Página «Conocimiento» (UI + actions)

Parte de la [Tarea 6](06-base-conocimiento.md). Depende de **06a**.

## Objetivo
CRUD visual de la KB desde una página top-level, calcando el gestor de Prompts.

## Ficheros
- `src/app/kb/actions.ts` (nuevo): `listKbAction(project?)`, `loadKbEntryAction`,
  `createKbAction`, `updateKbAction`, `deleteKbAction`. Forma `Res<T>` (como
  `app/prompts/actions.ts`); `revalidatePath('/kb')`.
- `src/app/kb/page.tsx` (nuevo, `force-dynamic`): carga índice server-side.
- `src/components/kb-manager.tsx` (nuevo, cliente): calca `prompts-manager.tsx`; filtros por
  **categoría** y **ámbito** (global/proyecto) + selector de proyecto; editor de `SKILL.md`
  (name/description/categoría/cuerpo) y gestión básica de `references/`.
- `src/components/sidebar.tsx`: entrada «Conocimiento» junto a «Prompts».

## Reutilizar
Núcleo de 06a; patrón de `prompts-manager.tsx` y `app/prompts/actions.ts`.

## Tests en profundidad
- Actions (vitest, `vi.mock('@/lib/env')` + tmpdir, patrón `launches.test.ts`): crear/editar/
  borrar/listar en ambos ámbitos; errores propagados (colisión, no-existe); nada toca datos reales.
- (UI sin test unitario: cubrir por `tsc`/`eslint` + validación manual, como el resto de paneles.)

## Validación (comprobada 2026-10-15)
- [x] Suite completa verde: **88 ficheros, 696 tests** (+5 de `app/kb/actions.test.ts`), exit 0.
- [x] `npx tsc --noEmit` sin errores; `npx eslint` limpio (actions, test, page, kb-manager, sidebar).
- [x] Actions: el servidor VALIDA el ámbito (`global` o proyecto existente) antes de escribir;
      `Res<T>`; cobertura de list (global/proyecto/scope inexistente→error), create/update en
      ambos ámbitos + colisión + scope inválido rechazado antes de escribir, rename→colisión/
      not-found, delete (true→false) a `.trash` + loadEntry con cuerpo/references.
- [x] Sidebar: entrada «Conocimiento» → `/kb` (no rompe tipos/lint de la navegación).
- [ ] **Manual pendiente** (`pnpm dev`): en `/kb` crear/editar/borrar entradas global y de
      proyecto con categoría y `description`, y verlas en el índice con su ámbito. (Verificado
      por lectura + tests de actions; la UI `kb-manager.tsx` no tiene test unitario.)

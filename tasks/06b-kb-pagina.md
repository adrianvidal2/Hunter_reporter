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

## Validación (la hace reporter)
- [ ] Suite verde + exit 0; `npx tsc --noEmit` y `npx eslint` limpios.
- [ ] Manual (`pnpm dev`): `/kb` crea/edita/borra entradas global y de proyecto con categoría
      y `description`; la entrada aparece en el índice con su ámbito.
- [ ] El sidebar muestra «Conocimiento» y no rompe la navegación existente.

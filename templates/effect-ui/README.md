# VibeLang + Effect UI starter

A browser app built with VibeLang, `@effect/ui`, `@effect/ui-kit`, Vite, and Vitest.

## Commands

```sh
bun run dev        # start the Vite dev server with Effect UI DevTools
bun run test       # run Story and HtmlScene tests in Vitest
bun run build      # type-check with vibe --noEmit and build for production
bun run format     # format .vibe files with `vibe format --write`
bun run check      # format check and `vibe lint`
```

## Files

- `src/Counter.vibe` — `schema` model, `UiSchema.TaggedEnum` messages, async `Command.Service` (`SaveCount`), and `Html.component` view using `@effect/ui-kit` `Button`
- `src/entry.ts` — mounts `Counter` with `BrowserHost.mount` and attaches `@effect/ui-devtools` in development
- `src/Counter.test.vibe` — deterministic `Story` and `HtmlScene` tests

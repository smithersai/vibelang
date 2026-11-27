# Effect UI Snake — One Vibe Core, Two Hosts (Web + OpenTUI)

One `.vibe` Snake core (`src/core.vibe` + `src/domain/*.vibe`) mounting cleanly to both **`@effect/ui/html`** (Browser) and **`@effect/ui-opentui`** (Terminal).

## What it shows

- **Single `.vibe` core**: `schema GameState`, `schema SnakeGameModel`, `UiSchema.TaggedEnum` semantic messages, `Command.make` (`GenerateApplePosition`), pure `stepClock`, VIP-21 `effect function* gameClockTicks` subscription, and `data CellKind`
- **Web host (`src/SnakeWeb.vibe`)**: `Html.component` + `HtmlSubscription.shortcuts` + exhaustive `match (classifyCell(...))` CSS grid, built with Vite
- **Terminal host (`src/SnakeTui.vibe`)**: `OpenTui.component` + `OpenTuiSubscription.shortcuts` + `OpenTuiCommand.quit()` + exhaustive `match (classifyCell(...))` ANSI cells, running on Node via `src/entry.tui.vibe`
- Verified with `vibelang -p tsconfig.json --noEmit` (with `strict: true` and `exactOptionalPropertyTypes: true`), `Story` tests for both Web and Terminal, `HtmlScene` DOM tests, and `vite build`

## Run

Web:
```sh
bun install
bun run dev
```

Terminal:
```sh
bun run dev:tui
```

## Check, test, and build

```sh
bun run test
```

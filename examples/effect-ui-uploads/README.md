# Effect UI Concurrent Uploads (VibeLang)

Concurrent file uploads with per-upload fiber cancellation and live streaming progress, ported from [`Effect-TS/ui/examples/interrupting-commands`](https://github.com/Effect-TS/ui/tree/main/examples/interrupting-commands).

## What it shows

- `schema UploadStatus = "Uploading" | "Done" | "Cancelled"` and `schema Upload` / `schema UploadsModel`
- `Command.Service` (`UploadFile`) with `group: ["uploadId"]` and `mode: "switch"` + `Command.interrupt` for single-upload and cancel-all fiber interruption
- Live streaming progress `Subscription` written as a Vibe `effect function*` producer (VIP-21) with automatic fiber cleanup on completion or cancellation
- Exhaustive `match (upload.status)` across view actions and status badges
- `@effect/ui-devtools` wired in development via `DevTools.layer()`
- `Story`, `HtmlScene`, and `TestClock` producer tests in Vitest

## Run

```sh
bun install
bun run dev
```

## Check, test, and build

```sh
bun run test
```

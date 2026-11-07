# Hello

The smallest Node.js VibeLang program: one function and one log.
`src/main.vibe` exports the Effect function. `src/entry.vibe` provides
`NodeServices.layer` and starts it with `NodeRuntime.runMain`.

From this directory, with `vibelang` on `PATH`:
```sh
bun install
bun run build
bun run start
```

Expected output: `Hello, VibeLang!`.
The key function in Effect TypeScript is:
```ts
import { Console, Effect } from "effect"
const main = Effect.fnUntraced(function* () {
  yield* Console.log("Hello, VibeLang!")
})
```

The written runner in `entry.vibe` starts the application. Importing
`main.vibe` leaves its exported function unrun.

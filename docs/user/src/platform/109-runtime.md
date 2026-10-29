# Runtime

A platform `runMain` starts a VibeLang application and ties its lifetime to the host process: it reports unhandled failures, handles termination signals, waits for cleanup, and chooses an exit code.

## Running an application entry point

```vibe
// preparation.vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-26
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

effect function main() {
  try Console.log("Preparing export")
  try sleep("100 millis")
  try Console.log("Export complete")
}

NodeRuntime.runMain(main())
// Output: Preparing export
// Output: Export complete
```

Pass the runner the Effect value, `main()`. Calling an effect function builds its Effect without running its body. The top-level runner starts the application. Supply application layers with `NodeRuntime.runMain(Effect.provide(main(), AppLive))`.

A runner also works in a plain callback passed from the top level to TypeScript, such as a framework's route handler or a `describe` body. Inside effect code, use `try` to run another Effect or `fork` to start a child. Tests in `.vibe` use `it.effect("name", () => effect { ... })`.

Bun uses `BunRuntime.runMain` from `@effect/platform-bun`; Node.js and Deno use the Node adapter. Run the generated JavaScript entry module after the VibeLang build. Import each Node module from its own subpath, as `@effect/platform-node/NodeRuntime`: the package's index loads every module, `NodeRedis` included, so under Yarn Classic `import { NodeRuntime } from "@effect/platform-node"` fails at startup with `Cannot find package 'redis'`.

## Configuring runtime launch behavior

```vibe
// startup-rejected.vibe
// pending: VIP-1, VIP-4, VIP-13, VIP-26
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

error StartupRejected {
  reason: string
}

effect function main() {
  throw new StartupRejected({ reason: "configuration missing" })
}

NodeRuntime.runMain(main(), { disableErrorReporting: true })
```

`disableErrorReporting` suppresses automatic failure logging; the failure stays a failure, and the default exit-code policy holds. Leave reporting on unless the application has another reporting boundary. The optional `teardown` callback controls completion handling and finally calls the provided exit callback.

```ts
// TypeScript (.ts)
// launch-options.ts
import { Exit, type Runtime } from "effect"

export const launchOptions = {
  teardown: ((exit, onExit) => {
    onExit(Exit.isSuccess(exit) ? 0 : 2)
  }) satisfies Runtime.Teardown
}
```

```vibe
// custom-entry.vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-26
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { launchOptions } from "./launch-options.ts"

effect function main() {
  try Console.log("Starting with custom exit handling")
}

NodeRuntime.runMain(main(), launchOptions)
// Output: Starting with custom exit handling
```

Teardown is a plain host callback, not an Effect program. Write a custom one in TypeScript when it calls the host's plain `onExit` function; put effectful cleanup in the application, before teardown runs. This example deliberately maps every failure to exit code 2.

## Handling completion and failures

```vibe
// invalid-batch.vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14, VIP-26
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

error InvalidBatch {
  count: number
}

effect function exportBatch(count: number) {
  try ensuring(effect {
    if (count <= 0) throw new InvalidBatch({ count })
    try Console.log(`Exporting ${count} records`)
  }, Console.log("Export cleanup finished"))
}

NodeRuntime.runMain(exportBatch(0))
```

A normal return is success; `main`'s return value isn't printed. An unhandled expected failure or defect is reported by default and gets a failing exit code. Effect 4.1.0's default teardown exits 0 on success, 130 for interruption-only causes, and 1 for other failures, unless a supported error-specific exit code overrides it.

On a termination signal, the platform interrupts the application and waits for registered cleanup. Finalizers registered with `ensuring`, `onExit`, and scoped acquisitions run during interruption. A `catch` expression handles typed failures and lets interruption propagate. Handle recoverable failures inside the program, and let the runner report the rest.

## Check process completion

These host-side checks run the emitted entries in separate processes to verify silent failure, cleanup before a failing exit, and both outcomes of the custom teardown.

```ts
// TypeScript (.ts)
// runtime-checks.ts
// types: node
import type {} from "./startup-rejected.vibe"
import type {} from "./invalid-batch.vibe"
import type {} from "./custom-entry.vibe"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

function launch(file: string) {
  return spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], { encoding: "utf8" })
}

const rejected = launch("./startup-rejected.js")
console.log(`rejected: ${rejected.status}, silent: ${rejected.stdout === "" && rejected.stderr === ""}`)
console.log(`custom: ${launch("./custom-entry.js").status}`)
const batch = launch("./invalid-batch.js")
console.log(`batch: ${batch.status}, cleaned: ${batch.stdout.includes("Export cleanup finished")}`)
const failedCustom = spawnSync(process.execPath, ["--input-type=module", "-e", `
  import { Effect } from "effect"
  import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
  import { launchOptions } from "./launch-options.js"
  NodeRuntime.runMain(Effect.fail("rejected"), { ...launchOptions, disableErrorReporting: true })
`], { cwd: fileURLToPath(new URL(".", import.meta.url)), encoding: "utf8" })
console.log(`custom failure: ${failedCustom.status}`)
// Output: rejected: 1, silent: true
// Output: custom: 0
// Output: batch: 1, cleaned: true
// Output: custom failure: 2
```

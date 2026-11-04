/**
 * Native inherited child execution in Node-compatible runtimes.
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import { spawn } from "node:child_process"
import * as ChildProcess from "../ChildProcess.js"

/**
 * A cold capability; the host is accessed only when `runInherited` executes.
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<ChildProcess.ChildProcess> = /* @__PURE__ */ Layer.succeed(
  ChildProcess.ChildProcess,
  ChildProcess.make({ spawn: (command, args, options) => spawn(command, [...args], options) })
)

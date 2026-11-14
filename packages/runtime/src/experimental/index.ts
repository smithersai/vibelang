/**
 * The `Experimental` namespace (D313): VibeLang's additions where Effect
 * lacks an API, in Effect's style, until Effect ships it. One module per
 * service or pure capability, named after the Effect module it extends
 * (`FileSystem`, `Dns`), the
 * Effect 4.0 module it keeps (`Crypto`), or as Effect would name it
 * (`Process`, `Locks` and the browser services). A `.vibe` file sees the
 * namespace without an import. Each service has its own key.
 * Pure modules need no service key or layer. The platform layers are in
 * `vibelang-runtime/experimental/platform-node`, `-bun`, `-browser` and `-worker`.
 *
 * @experimental
 * @since 0.0.11
 */
export * as Animations from "./Animations.js"
export * as BrowserInfo from "./BrowserInfo.js"
export * as ChildProcess from "./ChildProcess.js"
export * as Crypto from "./Crypto.js"
export * as Dns from "./Dns.js"
export * as Durable from "./Durable.js"
export * as Document from "./Document.js"
export * as Encoding from "./Encoding.js"
export * as Eval from "./Eval.js"
export * as FileReader from "./FileReader.js"
export * as Fuzz from "./Fuzz.js"
export * as FuzzSimulation from "./FuzzSimulation.js"
export * as Headers from "./Headers.js"
export * as Human from "./Human.js"
export * as FileSystem from "./FileSystem.js"
export * as Locks from "./Locks.js"
export * as MediaQuery from "./MediaQuery.js"
export * as Memory from "./Memory.js"
export * as NetAddress from "./NetAddress.js"
export * as NodeStream from "./NodeStream.js"
export * as Patterns from "./Patterns.js"
export * as Process from "./Process.js"
export * as ResizeObserver from "./ResizeObserver.js"
export * as Scorer from "./Scorer.js"
export * as Stdio from "./Stdio.js"
export * as Test from "./Test.js"
export * as Window from "./Window.js"
export * as AudioContext from "./AudioContext.js"
export * as Request from "./Request.js"

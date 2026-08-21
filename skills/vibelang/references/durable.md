# Durable and distributed execution

Read this only for opt-in durable work. Ordinary VibeLang functions never use the durable scheduler.

An `Action` has a closed durable function signature and an open provider implementation. A `Flow` is the closed plan produced by lowering a statically resolvable function passed to the imported `durable(...)` compiler intrinsic:

```ts
import { durable } from "vibelang:flows"

abstract class Compile extends Action<
  (input: CompileInput) => CompileOutput throws CompileError
> {}

const Build = durable((input: BuildInput) => {
  const compiled = Compile.run(input)
  return Package.run({ code: compiled.code })
})
```

`durable` is a compiler-recognized imported function, not a keyword. Recognition follows the resolved binding, and its argument must be statically resolvable. The compiler lowers the function's checked syntax and control flow without invoking it with proxies, replacing the call with a serializable Flow descriptor rather than a runtime callback wrapper. The compiler-owned virtual module has no uncompiled runtime fallback. `Action.run` lowers to a node, and symbolic values/projections create dependency edges. Runtime-dependent branches and loops become explicit Plan IR; a Flow may capture only compiler-known immutable values. Independent nodes may run concurrently, so request explicit sequencing when order matters without a data edge.

Plan/preview loads the emitted Plan IR and never loads or invokes the durable source function or an Action implementation. Known input may specialize a plan; unknown branches and runtime-sized fan-out remain explicit templates.

Action inputs, successes, and typed errors must satisfy the compiler-derived durable codec contract. Providers install ordinary compatible functions plus recovery/reuse policy; deployment may place implementations in local, sandboxed, native, Wasm, or remote workers.

Keep these guarantees distinct:

- every resolved node exit is journaled run-locally before downstream exposure;
- memoization chooses and reuses a canonical possibly nondeterministic success;
- content caching asserts deterministic equivalence from a complete content key;
- retry safety, compensation, placement, and reuse are independent policies.

Exact provider policy APIs, stable IDs, control-flow IR, sequencing, placement, and wire/migration syntax remain design work. Use `docs/DECISIONS.md` and `docs/DURABLE_EXECUTION.md` when available, and label proposed spelling as proposed.

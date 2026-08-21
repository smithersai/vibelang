# Durable and distributed execution

Read this only for opt-in durable work. Ordinary VibeLang functions never use the durable scheduler.

An `Action` has a closed durable function signature and an open provider implementation. A `Flow` is a closed comptime program that turns Action calls into typed Plan IR:

```ts
abstract class Compile extends Action<
  (input: CompileInput) => CompileOutput throws CompileError
> {}

const Build = comptime Flow((input: BuildInput) => {
  const compiled = Compile.run(input)
  return Package.run({ code: compiled.code })
})
```

During Flow compilation, `Action.run` performs no operation: it emits a node, and symbolic values/projections create dependency edges. Runtime-dependent branches and loops must become explicit Plan IR; a Flow may capture only comptime values. Independent nodes may run concurrently, so request explicit sequencing when order matters without a data edge.

Action inputs, successes, and typed errors must satisfy the compiler-derived durable codec contract. Providers install ordinary compatible functions plus recovery/reuse policy; deployment may place implementations in local, sandboxed, native, Wasm, or remote workers.

Keep these guarantees distinct:

- every resolved node exit is journaled run-locally before downstream exposure;
- memoization chooses and reuses a canonical possibly nondeterministic success;
- content caching asserts deterministic equivalence from a complete content key;
- retry safety, compensation, placement, and reuse are independent policies.

Exact provider policy APIs, stable IDs, control-flow IR, sequencing, placement, and wire/migration syntax remain design work. Use `docs/DECISIONS.md` and `docs/DURABLE_EXECUTION.md` when available, and label proposed spelling as proposed.


# Native, Wasm, and foreign targets

Read this only when portability beyond the TypeScript target matters.

VibeLang targets TypeScript/JavaScript, native code through LLVM, and Wasm. Source semantics stay consistent, but features fall into three classes:

1. portable;
2. valid while adding the transitive built-in `TypeScript` requirement;
3. forbidden in authored `.vibe`.

`any` and `eval` currently add `TypeScript`. Type-only imports do not. Normal classes, closures, generics, unions, async, and GC are intended to work natively; the full classification of reflection, prototype mutation, `Proxy`, weak references, custom thenables, and similar dynamic behavior remains open.

A native pin is a checked assertion over the complete call/provider graph, but its spelling is not settled. Never invent it as stable syntax. Platform APIs must be capabilities, and `comptime.target` may choose implementations.

Direct `.zig` and `.rs` imports are intended to compile to typed native or Wasm bindings with toolchain inputs tracked in the build cache. Treat exact tooling and configuration as evolving design.


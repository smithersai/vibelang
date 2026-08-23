# Hosts and foreign source imports

TypeScript is the only compilation target. Near-native/LLVM and Wasm compilation targets were specified once and are withdrawn, along with the `TypeScript` requirement, the portable/required/forbidden feature classification, and the portability pin. Do not reference any of them as current design.

What varies is the JavaScript **host**: Node, Bun, Deno, browser, or edge. Platform APIs must be capabilities rather than ambient globals, and `comptime.target` may select a host-specific implementation so unselected ones are not emitted.

`any` and `eval` are ordinary TypeScript in `.sm`. General guidance may lint against them; the language does not forbid them and they no longer add a requirement.

The checked `panic` channel on unannotated foreign calls is unrelated to any of the above and is retained: it exists because JavaScript can throw, reject, or violate its declaration.

Direct `.zig` and `.rs` imports use import attributes such as `with { type: "zig" }` and `with { type: "rust" }`. They compile to Wasm modules that the JavaScript host loads and calls, with toolchain inputs tracked in the build cache. Wasm is a library format here, not a target for Smithers code. Treat exact tooling and configuration as evolving design.

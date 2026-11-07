# Control operations and handlers

Effect handlers are an open proposal in VIP-35. They are not part of the language or the first release.

See [Services](../requirements-management/025-services.md), [Fibers](../concurrency/047-fibers.md), and [Producers](112-producers.md).

`vibelang --fix` can migrate a private one-operation `control` in a module with `number`, `string` or `boolean` contracts used by one directly returned operation run with `try` and a pure tail `resume` run with `try` to a `service` and `provide`. It refuses handler rest parameters and defaults, `__proto__` operations, exported `control` APIs, continuation-dependent handlers, `abandon` and `select`; redesign these with services, explicit Effect composition or Streams. There is no general continuation-preserving service rewrite.

Retired handler syntax and continuation-runtime bindings report `EK3501`; `select` reports `EK4607`. Native callback parameters such as `Effect.callback(resume => …)` and ordinary functions or methods with these names remain valid. The TypeScript mapper retains these diagnostics and continues to project other declarations in the file for editor feedback.

When the target scope cannot derive a service key, `vibelang --fix` writes the original control key as `static readonly key`.

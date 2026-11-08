# Control operations and handlers

Effect handlers are an open proposal in VIP-35. They are not part of the language or the first release.

See [Services](../requirements-management/025-services.md), [Fibers](../concurrency/047-fibers.md), and [Producers](112-producers.md).

Rewrite a `control` as a `service` and `provide`, explicit Effect composition or Streams.

Retired handler syntax and continuation-runtime bindings report `EK3501`; `select` reports `EK4607`. Native callback parameters such as `Effect.callback(resume => …)` and ordinary functions or methods with these names remain valid. The TypeScript mapper retains these diagnostics and continues to project other declarations in the file for editor feedback.

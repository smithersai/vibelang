# A caught throw in plain code is still EK0401

Will, 2026-10-31: synchronous VibeLang code never throws. Every `throw` in a
constructor, an accessor, a function a hatch runs, or the module's top level is
`EK0401`, even when the same code's own `catch` handles it. A `module` block's
body is TypeScript, so its getter's `throw` is JavaScript's, and the `throw` in
`main`, effect code, is `Effect.fail`.

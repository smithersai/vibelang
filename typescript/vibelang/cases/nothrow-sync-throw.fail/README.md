# Synchronous VibeLang code never throws

Will, 2026-10-31: "If you throw in vibelang itself in a sync function that's an
error." Each `throw` in synchronous code outside effect code is `EK0401`: a
function declaration, arrow and function expression with a plain return
annotation, a throw its own `try` catches, a throw expression, a parameter
default (an effect function's too: it runs before the Effect exists), a field
and `static` field initializer, a constructor, getter, setter, method, `static`
method and `static` block, an object-literal method, a plain generator, a plain
arrow nested in effect code, a plain `catch` handler and the module's top level.

The controls report nothing: `throw` in effect code and in an effect handler is
`Effect.fail`, `throw` in an `async` function rejects its Promise (decided
detail 251), and a `module` block's body and a `.ts` file are TypeScript.

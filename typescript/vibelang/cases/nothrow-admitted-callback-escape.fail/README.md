# An admitted callback's nested functions keep their own check

PREVIEW-5 (rev-preview pass 18): `Effect.try`'s thunk, `Effect.tryPromise`'s,
the `Promise` executor and an argument whose parameter type has `@throws` may
hold calls known to throw, because those throws belong to the receiving call.
That admission covers the literal's own body only. A function nested in it,
whether returned, stored on an object, passed on to `map` or called in place,
is its own plain code: a returned callback runs after `Effect.try` has
finished, so its `JSON.parse` would throw a native `SyntaxError` outside any
wrapper. Each such call is `EK0401`.

Controls report nothing: a direct call in the thunk, in a block-bodied thunk,
in the `Promise` executor, and a nested function that catches its own call.

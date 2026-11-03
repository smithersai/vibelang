# `throw` at the top level and in async parameter lists

Decided detail 253: the module top level is synchronous code outside effect
code, top-level `await` or not, so a `throw` there is `EK0401`, in a top-level
block and in a top-level `try` statement too. A `throw` in an ordinary
`async` function's parameter list rejects its Promise (decided detail 251), so
it reports nothing; an `async` generator runs its parameter list at the call
(detail 108), so a `throw` there is `EK0401`. A plain arrow called from an
`async` default is its own synchronous code.

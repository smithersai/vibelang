# A plain generator never throws

A generator not marked `effect` is a JavaScript generator (VIP-1), and
synchronous VibeLang code never throws (VIP-4; chapter 3): each
`throw` in a synchronous generator is `EK0401`, caught by its own `catch` or
not. An `async` generator's `throw` rejects, as in TypeScript (detail 251).

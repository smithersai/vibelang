# A plain generator throws as JavaScript does

A generator not marked `effect` is a JavaScript generator (VIP-1), and its
`throw` is JavaScript's (VIP-4): a throw that escapes `steps` or `later`
reaches the code that drives it, and a throw its own `catch` handles stays
inside, where the binding is `unknown`, as in TypeScript.

Before VIP-4 a generator with a JavaScript iterator annotation could not
throw (D296), and each escaping throw here was EK9203.

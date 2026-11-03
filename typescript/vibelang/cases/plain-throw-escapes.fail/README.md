# Synchronous VibeLang code never throws

A function with a plain return annotation is plain JavaScript. Will,
2026-10-31: "If you throw in vibelang itself in a sync function that's an
error." Each throw here is `EK0401` at the throw: a throw statement, a throw
expression, a throwing match arm and do block, a method, a rethrow from a
catch, and a plain callback.

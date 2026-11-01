# A plain function throws as JavaScript does

VIP-4: in a plain function, `throw` is JavaScript's throw. Each function
here is plain (VIP-1) and throws `Invalid` out of it: a throw statement, a
throw expression, a throwing match arm and do block, a method, a rethrow
from a catch, and a callback that `map` calls. A plain caller's `catch`,
JavaScript's, catches each one.

Before VIP-4 a plain return annotation meant the function never failed, and
each throw here was EK9203 (D282, retired by VIP-4's 2026-10-29 amendment).

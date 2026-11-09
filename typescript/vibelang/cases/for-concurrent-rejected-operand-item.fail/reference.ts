// The native loops: one TypeScript error each, at the operand.
declare const value: unknown
declare const maybe: number[][] | undefined

function arrayPattern() { for (const [item = 0] of value) { void item } }
function objectPattern() { for (const { length } of maybe) { void length } }
function bodyDestructure() { for (const item of value) { const [z] = item; void z } }
function isHead() { for (const [item = 0] of maybe) { void item } }

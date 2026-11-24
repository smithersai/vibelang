// TypeScript keeps JavaScript's throw; a synchronous VibeLang function never
// throws (VIP-4, 2026-10-31).
export function thrower(): never {
  throw "bad"
}

// TypeScript keeps JavaScript's throw; a synchronous VibeLang function never
// throws (Will, 2026-10-31).
export function thrower(): never {
  throw "bad"
}

// TypeScript keeps JavaScript's throw; a synchronous VibeLang function never
// throws (Will, 2026-10-31), so the cases that test plain try, catch and
// finally throw through this.
export function raise(e: unknown): never {
  throw e
}

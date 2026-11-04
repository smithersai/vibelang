// Native timers live in TypeScript; wrapper thunks in .vibe keep VIP-33.
 /** @throws {never} */
export function schedule(task: () => void, milliseconds: number): ReturnType<typeof setTimeout> {
  return setTimeout(task, milliseconds)
}
/** @throws {never} */
export function cancel(timer: ReturnType<typeof setTimeout>): void {
  clearTimeout(timer)
}

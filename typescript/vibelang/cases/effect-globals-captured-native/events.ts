export const events: string[] = []
/** @throws {never} */
export function ev(event: string): void { events.push(event) }

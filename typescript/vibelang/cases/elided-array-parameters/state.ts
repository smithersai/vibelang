export let bodies = 0
/** @throws {never} */
export function note(): void { bodies++ }
/** @throws {never} */
export function reset(): void { bodies = 0 }

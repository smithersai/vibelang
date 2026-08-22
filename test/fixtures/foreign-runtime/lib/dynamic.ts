/** @module @throws {never} */
const nested = await import("./nested.ts")

export const dynamicValue: string = nested.nestedValue()

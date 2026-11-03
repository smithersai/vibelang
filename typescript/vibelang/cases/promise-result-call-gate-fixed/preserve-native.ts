export const sentinel = { message: "native throw" }
export function bad(): Promise<never> { throw sentinel }

export function classify(s: unknown, Function: (s: unknown) => boolean) { return Function(s) }
export function arm(s: unknown, Function: (s: unknown) => boolean) { return Function(s) ? true : false }
export const main = () => [classify(1, x => typeof x === "number"), classify("x", x => typeof x === "number"), arm("x", x => typeof x === "string"), arm(1, x => typeof x === "string")]

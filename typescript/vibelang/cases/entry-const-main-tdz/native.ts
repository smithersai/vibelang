let seen: unknown
function read(): unknown { return main }
try { seen = typeof read() }
catch (e) { seen = e instanceof Error ? e.name : String(e) }
export const main = (): number => 7
export function probe(): unknown { return [seen, typeof read(), main()] }

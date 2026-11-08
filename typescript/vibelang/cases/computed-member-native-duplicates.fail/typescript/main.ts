// expect: TS2300 TS2300 TS2717
// Ordinary computed members retain the pinned TypeScript duplicate checks.
const key = "x" as const
type Row = { readonly [key]: number; readonly ["x"]: string }
export {}

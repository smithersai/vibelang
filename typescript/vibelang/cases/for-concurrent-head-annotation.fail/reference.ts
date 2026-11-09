// expect: TS2483 TS2483 TS2483 TS2483 TS2483 TS2483 TS2304 TS2322 TS1334 TS1333
// A rejected head annotation is checked but does not type the item.
export function identifier(xs: number[]) {
  for (const x: string of xs) { const n: number = x; void n }
}
export function pattern(rows: Array<{ n?: number }>) {
  for (let { n = 1 }: { n?: string } of rows) { const value: number = n; void value }
}
export function missingType(xs: number[]) {
  for (const x: Missing of xs) { void x }
}
export function bodyError(xs: number[]) {
  for (const x: number of xs) { const n: string = x; void n }
}

export function unique(xs: number[]) {
  for (const x: unique symbol of xs) { void x }
}

export function uniquePattern(xs: Array<{n: number}>) {
  for (const {n}: unique symbol of xs) { void n }
}

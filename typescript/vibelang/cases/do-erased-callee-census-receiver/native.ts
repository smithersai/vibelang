export function probe(): number { const obj = { n: 5, m(x: number): number { return this.n + x } }; return obj.m!((() => 2)()) }

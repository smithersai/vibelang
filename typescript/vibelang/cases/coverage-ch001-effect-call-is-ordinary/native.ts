export interface Ordinary { effect(): number }; const x: Ordinary = { effect() { return 1 } }; export const n = x.effect()

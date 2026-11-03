import { Effect } from "effect"
export function ordinary(s: Date | { kind: string }) { if (!(s instanceof Date)) return s.kind; return s.getUTCFullYear() }
class Plain { n = 1 }
export function named(s: Plain | { kind: string }) { if (!(s instanceof Plain)) return s.kind; return s.n }
export function main(): Effect.Effect<unknown> { return Effect.sync(() => [ordinary(new Date(0)), ordinary({kind:"k"}), named(new Plain()), named({kind:"v"})]) }

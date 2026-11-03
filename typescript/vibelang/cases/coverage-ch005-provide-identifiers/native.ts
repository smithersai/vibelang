import { Effect } from "effect"
function provide(n: number) { return n + 1 }
function called() { provide(1); return provide(2) }
function indexed() { const provide = [10, 20]; provide[0] = provide[1]; return provide }
function shadowed() { const provide = "local"; return provide }
function subtracted() { const provide = 10; return provide - 1 }
export function controls() { return { called: called(), indexed: indexed(), shadowed: shadowed(), subtracted: subtracted() } }
export function main() { return Effect.gen(function* () { return controls() }) }

import { Context, Effect } from "effect"
function join(a: string, b: string): string { return a + b }
const Flags = Context.Reference<{ value: string }>("coverage/JoinedFlags", { defaultValue: () => ({ value: join("ordinary", "-join") }) })
export function main() { return Effect.map(Flags, f => f.value) }

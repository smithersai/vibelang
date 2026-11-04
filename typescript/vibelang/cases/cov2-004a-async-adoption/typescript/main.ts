import { Effect } from "effect"
function compute(): Promise<number> { return (async () => { const s=await Promise.resolve(true); if(s) return await Promise.resolve(7); return Promise.resolve(0) })() }
export function main(): Effect.Effect<unknown> { return Effect.promise(async () => { const value: number = await compute(); return value }) }

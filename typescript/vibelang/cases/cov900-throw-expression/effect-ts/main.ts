import {Effect} from "effect"
async function requireValue(x: number | null | undefined) { const value=x; if(value!==null && value!==undefined) return value; throw new Error("missing") }
async function requireProperty(input: {readonly value: number | null | undefined}) { const value=input.value; if(value!==null && value!==undefined) return value; throw new Error("missing") }
async function witness() {
 let reads = 0
 const input = { get value() { reads++; return 7 } }
 const missing = { get value() { reads++; return undefined } }
 const value = await requireProperty(input)
 const first = await requireValue(null).then(() => new Error("unexpected"), (e: Error) => e)
 const second = await requireValue(undefined).then(() => new Error("unexpected"), (e: Error) => e)
 const third = await requireProperty(missing).then(() => new Error("unexpected"), (e: Error) => e)
 return [value, reads, first.name+":"+first.message, second.name+":"+second.message, third.name+":"+third.message, first!==second && second!==third]
}
export function main() { return Effect.tryPromise(() => witness()) }

import { Effect } from "effect"
const error = 1
const schema = 2
const data = 3
function caught() { try { throw 4 } catch (error) { return typeof error === "number" ? error : 0 } }
export function main() { return Effect.succeed([error, schema, data, caught()]) }

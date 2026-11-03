import { Effect } from "effect"
import { queryDb } from "./boundary.js"
export function main() { return Effect.tryPromise(queryDb) }

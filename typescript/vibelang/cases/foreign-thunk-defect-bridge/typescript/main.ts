import { Effect } from "effect"
import { rejects, throwsFirst, boom, load } from "./foreign.js"
export const rejected = Effect.promise(rejects)
export const thrownFirst = Effect.promise(throwsFirst)
export const thrown = Effect.sync(boom)
export const loaded = Effect.promise(load)

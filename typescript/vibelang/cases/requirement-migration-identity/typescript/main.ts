import { Effect } from "effect";
import { Input as Renamed } from "./dep.js";
import * as D from "./namespaced.js";
import { Input as Other } from "./other.js";
type Input = any;
export function f(): Effect.Effect<number, never, Renamed> { return Effect.gen(function* () { return (yield* Renamed).value }) }
export function g(): Effect.Effect<number, never, D.Input> { return Effect.gen(function* () { return (yield* D.Input).value }) }
export function h(): Effect.Effect<number, never, Renamed | Other> { return Effect.gen(function* () { return (yield* Renamed).value + (yield* Other).value }) }

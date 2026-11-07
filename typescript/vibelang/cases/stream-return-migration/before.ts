import { Effect } from "effect"
import { marker, knownMarker } from "./lib.js"
export const markerResult = () => Effect.gen(function* () { return marker() })
export const knownResult = () => Effect.gen(function* () { return knownMarker() })

import { Effect } from "effect"
import { hostKind } from "./native.js"
export function main() { return Effect.try(() => hostKind()) }

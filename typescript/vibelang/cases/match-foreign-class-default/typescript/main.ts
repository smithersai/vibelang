import { Effect } from "effect"
import { Wanted, Other } from "./classes.js"
/** @throws {never} */
export function label(s: Wanted) { return s instanceof Wanted ? "wanted" : "other" }
const sameShape: Wanted = new Other()
export function main() { return Effect.gen(function* () { return [label(new Wanted()), label(sameShape)] }) }

import {Effect,Data} from "effect"
class BadJson extends Data.TaggedError("BadJson")<{cause:string}> {}
export function main() { return Effect.try({try: () => JSON.parse("{"),catch: () => new BadJson({cause:"invalid"})}) }

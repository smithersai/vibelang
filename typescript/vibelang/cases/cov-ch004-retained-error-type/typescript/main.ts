import { Effect } from "effect"
import * as Cause from "effect/Cause"
export function probe(s:unknown){if(Cause.isTimeoutError(s))return s._tag;return typeof s==="object"&&s!==null&&"_tag" in s&&s._tag==="TimeoutError"?("invalid" as const):("other" as const)}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>[probe(new Cause.TimeoutError()),probe({_tag:"TimeoutError"}),probe(null)])}

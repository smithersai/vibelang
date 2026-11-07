// The TypeScript twin of entry.vibe.
import "vibelang-runtime"
import { events, log } from "./log.ts"
import { isOne } from "./a-ts.ts"
import { isTwo } from "./b-ts.ts"
import { isThree, ready } from "./tla-ts.ts"
import { isFour } from "./after-ts.ts"
log("entry " + ready + " " + [isOne(1), isTwo(2), isThree(3), isFour(4), isOne(2)].join(","))
export const trace = events

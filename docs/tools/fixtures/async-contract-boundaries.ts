// Native TypeScript witness retained from chapter 003 before 66e1ff463707.
// VIP-4: async callback failure rejects; a plain Promise producer can throw.
import { Effect } from "effect"

/** @rethrows f */
async function invokeAsync(f: () => number) { return f() }
/** @rethrows f */
function invokePlain(f: () => number) { return Promise.resolve(f()) }
const checkedAsync = Effect.tryPromise({ try: () => invokeAsync(() => { throw "callback" }), catch: (error) => error })
const checkedPlain = Effect.try({ try: () => invokePlain(() => { throw "callback" }), catch: (error) => error })
// Both fail with "callback" through their matching wrappers; only invokePlain throws at the call.

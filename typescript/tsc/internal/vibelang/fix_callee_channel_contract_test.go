package vibelang

import ()

const calleeChannelFixHead = `import { Effect } from "effect"
class ApiError extends Error { readonly _tag = "ApiError"; readonly status = 503 }
declare const hostname: () => Effect.Effect<string | undefined, Error | ApiError>
const quiet = effect (n: number) => n
export const program = effect (n: number) => { try quiet(n); try hostname() }
`

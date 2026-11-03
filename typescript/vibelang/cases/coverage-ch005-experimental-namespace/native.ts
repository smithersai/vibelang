import { Effect } from "effect"
import * as Experimental from "vibelang-runtime/experimental"
export const process = Experimental.Process
export const crypto = Experimental.Crypto
export const main=()=>Effect.gen(function* () { return [typeof process,typeof crypto] })

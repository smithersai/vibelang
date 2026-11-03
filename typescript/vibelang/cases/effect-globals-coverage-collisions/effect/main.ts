import {Effect} from "effect"
const collisions=[
Effect.catch===Effect.catch,
Effect.interruptible===Effect.interruptible,
Effect.let===Effect.let,
Effect.match===Effect.match,
Effect.provide===Effect.provide,
Effect.service===Effect.service,
Effect.try===Effect.try,
Effect.undefined===Effect.undefined,
Effect.uninterruptible===Effect.uninterruptible,
Effect.void===Effect.void,
Effect.when===Effect.when
]
export function main(){const empty:undefined=undefined;return Effect.succeed([collisions,empty===undefined])}

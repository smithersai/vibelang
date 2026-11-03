import {Effect} from "effect"
function stopped(){return 5}
export function main():Effect.Effect<unknown>{return Effect.succeed(stopped())}

import type { Context, Effect } from "effect"
import { task, Missing, Service, Data } from "../out/main.js"
const program: Effect.Effect<number> = task()
const shape: Context.Service.Shape<typeof Service> = {n: 1}
const error = new Missing({n: 1})
const schema = Data
void [program, shape, error, schema]

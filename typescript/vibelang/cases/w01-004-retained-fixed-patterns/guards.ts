// Schema.isSchemaError is a function declaration without a @throws contract;
// a typed constant gives the oracle the same guard as a nonthrowing value.
import { Schema } from "effect"
export const isSchemaErrorGuard: (u: unknown) => boolean = Schema.isSchemaError

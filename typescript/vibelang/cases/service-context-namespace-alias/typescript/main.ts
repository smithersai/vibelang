import * as Ctx from "effect/Context"
type Database_shape = { readonly value: number }
/** A database key. */
export class Database extends Ctx.Service<Database, Database_shape>()("alchemy/Database") {}
export declare namespace Database { type Shape = Database_shape }
export const value = 7

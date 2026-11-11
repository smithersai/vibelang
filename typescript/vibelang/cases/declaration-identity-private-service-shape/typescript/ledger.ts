import { Context } from "effect"

type Ledger_shape = { total: number }
export class Ledger extends Context.Service<Ledger, Ledger_shape>()("case/Ledger") {}
export declare namespace Ledger { type Shape = Ledger_shape }

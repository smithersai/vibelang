import { Context } from "effect"
import { Ledger } from "./ledger.js"

type Private_shape = { v: number }
class Private extends Context.Service<Private, Private_shape>()("case/Private") {}
declare namespace Private { type Shape = Private_shape }
type Third_shape = { z: number }
class Third extends Context.Service<Third, Third_shape>()("case/Third") {}
declare namespace Third { type Shape = Third_shape }
type Unused_shape = { u: number }
class Unused extends Context.Service<Unused, Unused_shape>()("case/Unused") {}
declare namespace Unused { type Shape = Unused_shape }

export const a: Private.Shape = { v: 1 }
export function annotated(x: Third.Shape): Array<Third.Shape> {
  return [x]
}
export const fakeLedger: Ledger.Shape = { total: 1 }

export type Alias = Private.Shape
export interface Wide extends Third.Shape {
  extra: number
}
export class Box {
  inner: Private.Shape = { v: 1 }
}

export namespace Inner {
  type Hidden_shape = { h: number }
  class Hidden extends Context.Service<Hidden, Hidden_shape>()("case/Hidden") {}
  declare namespace Hidden { type Shape = Hidden_shape }
  export const hidden: Hidden.Shape = { h: 1 }
}

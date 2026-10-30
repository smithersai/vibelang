export interface Shape { value: number }
export interface Optional { value?: number; readonly fixed?: string }
export interface Dictionary { [key: string]: number }
export interface ReadonlyDictionary { readonly [key: string]: number }
export type Literal = { value: number; optional?: string; readonly fixed: number }
export type Nested = { inner: { value: number }; readonly fixed: { value: number } }
export type Wrapped = Readonly<{ inner: { value: number }; readonly fixed: number }>
export class Fields {
  value = 1
  optional?: string
  readonly fixed: number = 2
  static count = 0
  static readonly version: number = 1
}
export interface Explicit { readonly value: number }

import { Data as Data_1 } from "effect"
export const Data = "user namespace"
export const Parcel: Data_1.TaggedEnum.Constructor<Parcel> = Data_1.taggedEnum<Parcel>()
export type Parcel = Data_1.TaggedEnum<{ Empty: {}; Value: { readonly value: number } }>
export const empty = Parcel.Empty()
export const value = Parcel.Value({ value: 7 })
export function generic(): string {
  const Data = "local namespace"
  type Box<Data> = Data_1.TaggedEnum<{ Value: { readonly value: Data } }>
  interface BoxDefinition extends Data_1.TaggedEnum.WithGenerics<1> {
    readonly taggedEnum: Box<this["A"]>
  }
  const Box = Data_1.taggedEnum<BoxDefinition>()
  return Box.Value<string>({ value: Data }).value
}

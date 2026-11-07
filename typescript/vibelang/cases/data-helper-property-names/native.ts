import { Data } from "effect"
const properties = { $Packet$Definition: 1, $Packet$Definition$2: 2 }
type Packet<A> = Data.TaggedEnum<{ Value: { value: A } }>
interface $Packet$Definition extends Data.TaggedEnum.WithGenerics<1> {
 readonly taggedEnum: Packet<this["A"]>
}
const Packet = Data.taggedEnum<$Packet$Definition>()
/** @throws {never} */
export function nativeValues(): readonly number[] {
 const packet = Packet.Value({ value: 3 })
 return [properties.$Packet$Definition, properties.$Packet$Definition$2, packet.value]
}

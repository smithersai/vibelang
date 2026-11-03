import { Data, Effect } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Delivery = Data.TaggedEnum<{ Waiting: {}; Sent: { tracking: string }; Rejected: { reason: string } }>
const Delivery = Data.taggedEnum<Delivery>()
export function main() {
  return Effect.gen(function* () {
    const sent = Delivery.Sent({ tracking: "parcel" })
    const tracking = "outer"
    const bound = sent._tag === "Sent" ? sent.tracking : "none"
    const exists = "tracking" in sent ? tracking : "none"
    return [Delivery.Waiting()._tag, sent._tag, bound, exists, Delivery.Rejected({ reason: "bad" }).reason, Delivery.$is("Sent")(sent)]
  })
}

// TypeScript code that uses data types through their declarations.
import { Effect, Equal } from "effect"
import { Box, Delivery, track } from "../../out/main.js"

const describe = Delivery.$match({
  Waiting: () => "waiting",
  Sent: ({ tracking }) => `sent ${tracking}`,
  Rejected: ({ reason }) => `rejected: ${reason}`
})

const sent: Delivery = Delivery.Sent({ tracking: "parcel-8" })
const isSent = Delivery.$is("Sent")
const tracking: string = isSent(sent) ? sent.tracking : ""
const full: Box<number> = Box.Full({ value: 3 })
const unboxed = Box.$match(full, { Full: ({ value }) => value * 2, Empty: () => 0 })

export const lines: ReadonlyArray<string> = [
  describe(Delivery.Waiting()),
  describe(sent),
  describe(Delivery.Rejected({ reason: "no address" })),
  tracking,
  String(Equal.equals(sent, Delivery.Sent({ tracking: "parcel-8" }))),
  String(unboxed)
]
export const viaVibe: Effect.Effect<string, never, never> = track(sent)

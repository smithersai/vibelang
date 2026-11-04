import { Effect } from "effect"
// JavaScript counterpart of the former plain match default arm.
export const plainThrown = Effect.sync(() => {
  try { switch (true) { default: throw "bad" } }
  catch (error) { return error }
})

// VIP-5: native await preserves JavaScript behavior; repair through a Promise bridge.
import { Fiber } from "effect"
/** @throws {never} */
export async function probe(f: Fiber.Fiber<number>) { return await f }

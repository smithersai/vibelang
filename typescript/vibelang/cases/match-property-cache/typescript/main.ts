// Finite TypeScript witness for VIP-7's cached property order.
// The shared first read stands for GetCached, not a general match lowering.
import { Effect } from "effect"

function witness() {
  const trace: string[] = []
  const subject = {
    get first() { trace.push("first"); return 1 },
    get second() { trace.push("second"); return 2 }
  }
  const first = subject.first
  let value = "miss"
  if (first === 0) {
    const second = subject.second
    if (second === 2) value = "bad"
  } else if (first === 1) {
    const second = subject.second
    if (second === 2) value = "hit"
  }
  return [value, trace]
}

export function main() { return Effect.succeed(witness()) }


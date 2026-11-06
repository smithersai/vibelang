import { StringDecoder } from "node:string_decoder"

// Keep progress independent of diagnostics and source text. These phases and
// counters are the native fixer's progress protocol; its activity text is not
// part of a migration receipt.
const phases = "start|legacy readonly source upgrade|round|try|prelude|imports|directives"
const duration = "(?:[0-9]+(?:\\.[0-9]+)?(?:ns|µs|ms|s|m|h))+"
const header = new RegExp("^vibelang --fix: (" + duration + "): (" + phases + ")(?: ([0-9]+))?: ([0-9]+) fix(?:es)? applied, ([0-9]+) pending(?:, ([0-9]+) refused)?; ([0-9]+) checks?, ([0-9]+) this (?:round|phase) \\(([0-9]+) whole, ([0-9]+) partial\\); ")
const heap = /; heap ([0-9]+) MiB, goal ([0-9]+) MiB, ([0-9]+) GCs$/
const maxLine = 16384
const number = value => value === undefined ? 0 : Number(value)

export function parseFixProgress(line) {
  const m = header.exec(line)
  if (!m) return null
  const event = { elapsed: m[1], phase: m[2], round: number(m[3]), applied: number(m[4]), pending: number(m[5]), refused: number(m[6]), checks: number(m[7]), phaseChecks: number(m[8]), whole: number(m[9]), partial: number(m[10]) }
  const memory = heap.exec(line)
  if (memory) Object.assign(event, { heapMiB: number(memory[1]), heapGoalMiB: number(memory[2]), gcs: number(memory[3]) })
  if (Object.values(event).some(value => typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))) return null
  return event
}

/** Decode complete progress lines without retaining unbounded diagnostic text. */
export function fixProgressStream(emit) {
  const decoder = new StringDecoder("utf8")
  let pending = "", discarding = false
  const text = chunk => {
    const parts = chunk.split("\n")
    for (let i = 0; i < parts.length; i++) {
      const complete = i < parts.length - 1
      if (!discarding) {
        if (pending.length + parts[i].length > maxLine) { pending = ""; discarding = true }
        else pending += parts[i]
      }
      if (complete) {
        const line = pending, accept = !discarding
        pending = ""; discarding = false
        if (accept) {
          const event = parseFixProgress(line.replace(/\r$/, ""))
          if (event) emit(event)
        }
      }
    }
  }
  return {
    write(chunk) { text(decoder.write(chunk)) },
    end() {
      text(decoder.end())
      if (!discarding && pending) {
        const event = parseFixProgress(pending.replace(/\r$/, ""))
        pending = ""
        if (event) emit(event)
      }
    }
  }
}

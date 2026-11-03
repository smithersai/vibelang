import { Effect } from "effect"
export function ordinary() { return [Date.now(), Math.random(), JSON.stringify({ n: 1 }), Intl.NumberFormat] }
export function main() { return Effect.gen(function* () {
  const url = new URL("/a?q=1", "https://example.test")
  const params = new URLSearchParams("q=1")
  const bytes = new TextEncoder().encode("ok")
  const signal = new AbortController().signal
  return [url.hostname, params.get("q"), new TextDecoder().decode(bytes), structuredClone({ n: 1 }).n, atob(btoa("ok")), signal.aborted]
}) }

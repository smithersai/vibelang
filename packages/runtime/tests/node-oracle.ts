import { fileURLToPath } from "node:url"

type Request<A> = (inputs: ReadonlyArray<string>) => Promise<Array<A>>

// Keep the oracle in actual Node while amortizing startup across one property's
// samples and shrink attempts. Each response must belong to this request.
export async function withNodeOracle<A>(
  kind: "ipv6" | "base64",
  run: (request: Request<A>) => Promise<void>
): Promise<void> {
  const fixture = fileURLToPath(new URL("./fixtures/node-oracle.mjs", import.meta.url))
  const child = Bun.spawn(["node", fixture, kind], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
  const stderr = new Response(child.stderr).text()
  let buffer = ""
  let sequence = 0
  let completed = false
  const request: Request<A> = async inputs => {
    const id = ++sequence
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; child.kill() }, 15_000)
    try {
      child.stdin.write(JSON.stringify({ id, inputs }) + "\n")
      await child.stdin.flush()
      while (!buffer.includes("\n")) {
        const next = await reader.read()
        if (next.done) throw new Error(timedOut ? "Node oracle request " + id + " timed out" : "Node oracle ended before response " + id)
        buffer += next.value
        if (buffer.length > 262_144) throw new Error("Node oracle response exceeded its bound")
      }
      const end = buffer.indexOf("\n")
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      const response = JSON.parse(line)
      if (response.id !== id || !Array.isArray(response.values) || response.values.length !== inputs.length) {
        throw new Error("Node oracle response did not match its request")
      }
      const valid = kind === "ipv6"
        ? response.values.every((value: unknown) => typeof value === "boolean")
        : response.values.every((value: unknown) => Array.isArray(value) &&
            value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255))
      if (!valid) throw new Error("Node oracle returned invalid values for request " + id)
      return response.values
    } finally {
      clearTimeout(timeout)
    }
  }
  try {
    await run(request)
    completed = true
  } finally {
    const timeout = setTimeout(() => child.kill(), 15_000)
    try {
      try { child.stdin.end() } catch { child.kill() }
      const status = await child.exited
      const errors = await stderr
      if (completed && (status !== 0 || errors !== "")) throw new Error("Node oracle exit " + status + ", stderr characters " + errors.length)
    } finally {
      clearTimeout(timeout)
      reader.releaseLock()
    }
  }
}

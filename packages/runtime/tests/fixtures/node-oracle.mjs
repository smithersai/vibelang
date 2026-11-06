import { isIPv6 } from "node:net"
import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

const kind = process.argv[2]
if (kind !== "ipv6" && kind !== "base64") throw new Error("unknown oracle")
let requests = 0
let comparedInputs = 0
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const { id, inputs } = JSON.parse(line)
  requests++
  comparedInputs += inputs.length
  const values = inputs.map(value => kind === "ipv6" ? isIPv6(value) : Array.from(Buffer.from(value, "base64")))
  process.stdout.write(JSON.stringify({ id, values }) + "\n")
}

// The resource regression records counts only, never request contents.
if (process.env.NODE_ORACLE_METRICS) {
  appendFileSync(process.env.NODE_ORACLE_METRICS, JSON.stringify({ kind, requests, comparedInputs }) + "\n")
}

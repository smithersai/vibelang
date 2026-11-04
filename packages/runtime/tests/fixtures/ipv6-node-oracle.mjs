import { isIPv6 } from "node:net"
let input = ""
for await (const chunk of process.stdin) input += chunk
const values = JSON.parse(input)
process.stdout.write(JSON.stringify(values.map((value) => isIPv6(value))))

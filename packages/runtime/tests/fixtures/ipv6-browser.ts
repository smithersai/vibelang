import { NetAddress } from "vibelang-runtime/experimental"
const host = globalThis as unknown as { result: boolean[]; noPlatform: boolean }
host.result = ["::1", "::1%4294967296", "::1%💩", "::ffff:127.0.0.1%eth0"].map(NetAddress.isIPv6)
host.noPlatform = typeof (globalThis as { process?: unknown }).process === "undefined"
  && typeof (globalThis as { require?: unknown }).require === "undefined"

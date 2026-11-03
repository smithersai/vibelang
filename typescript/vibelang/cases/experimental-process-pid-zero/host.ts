import { kill } from "node:process"

// A native reference for the compiler case; no host paths or process ids escape.
export const nativeZero: boolean | "BadArgument" | "Unknown" = (() => {
  try { kill(0, 0); return true } catch (error) {
    const code = (error as { readonly code?: string }).code
    if (code === "ESRCH") return false
    if (code === "EPERM") return true
    return code === "EINVAL" || code === "ERR_UNKNOWN_SIGNAL" ? "BadArgument" : "Unknown"
  }
})()

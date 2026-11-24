// The package test gate supplies VIBELANG_BINARY. Local runs without the
// prepared toolchain can still exercise tests that don't need it.
export function requireOrSkip(reason) {
  if (reason && (process.env.VIBELANG_BINARY || process.env.CI)) {
    throw new Error("Missing compiler test prerequisite: " + reason)
  }
  return reason
}

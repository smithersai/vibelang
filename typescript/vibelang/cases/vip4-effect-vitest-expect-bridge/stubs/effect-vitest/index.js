export * from "vitest"
export const tests = []
export const it = {
  effect(name, self) {
    tests.push([name, self])
  }
}

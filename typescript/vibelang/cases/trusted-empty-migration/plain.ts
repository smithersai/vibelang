export const foreign = function (this: unknown, n: number): number {
  if (this !== undefined) throw "receiver"
  if (n < 0) throw n
  return n * 2
}

let applyReads = 0
let captureReads = 0
Object.defineProperty(foreign, "apply", {
  get() { applyReads++; return Function.prototype.apply }
})
export const Dialect = { get integer() { captureReads++; return foreign } }
export const counts = () => ({ captureReads, applyReads })

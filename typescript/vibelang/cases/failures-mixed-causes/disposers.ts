// Disposers and iterator closers that throw. TypeScript keeps JavaScript's
// throw, which the kernel turns into a defect.
export function disposeDies(): Disposable {
  return { [Symbol.dispose]() { throw new Error("D") } }
}

export function closeDies(): IteratorResult<number> {
  throw new Error("D")
}

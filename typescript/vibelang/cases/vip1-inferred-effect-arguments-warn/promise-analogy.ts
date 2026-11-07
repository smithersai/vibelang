// The TypeScript analogy behind the warning: an unawaited Promise passed to a
// generic compiles without an error; only a linter reports it.
function expect<T>(actual: T) { return { toBeTruthy: () => !!actual } }
async function asyncFn() { return 1 }
export const truthy = expect(asyncFn()).toBeTruthy()

export const marker = new RangeError("executor")
/** @throws {RangeError} */
export function risky(): never { throw marker }
/** @throws {RangeError} */
export function executor(resolve: (value: number) => void): void { resolve(risky()) }

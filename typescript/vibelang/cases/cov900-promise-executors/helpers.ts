/** @throws {never} */
export function later(message: string): Promise<never> {
  return new Promise(() => { throw new Error(message) })
}

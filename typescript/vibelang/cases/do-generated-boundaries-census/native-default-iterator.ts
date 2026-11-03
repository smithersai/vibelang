/** @throws {never} */
export function* holes(log: string[]): Generator<number | undefined> {
  try { log.push("start"); yield undefined }
  finally { log.push("closed") }
}

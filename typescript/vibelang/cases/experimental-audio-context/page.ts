// The page side of the case: a fake AudioContext, and foldkit's note player, the host graph that stays TypeScript.
/** @throws {never} */
export const fakeContext = (log: Array<string>): AudioContext =>
  ({ state: "running", close: async () => void log.push("closed") }) as unknown as AudioContext

/** @throws {never} */
export const playNote = (context: AudioContext, log: Array<string>, note: string): void => {
  log.push(`${context.state} ${note}`)
}

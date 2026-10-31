// The page side of the case: VIP-33 bans Blob in a .vibe file, so a file comes from TypeScript, as an input's does.
/** @throws {never} */
export const textFile = (): Blob => new Blob(["hi"], { type: "text/plain" })

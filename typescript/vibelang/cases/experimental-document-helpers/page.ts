// The page side of the case: a fake document, from TypeScript, where EventTarget is not banned.
/** @throws {never} */
export const fakeDocument = (): Document => new EventTarget() as unknown as Document

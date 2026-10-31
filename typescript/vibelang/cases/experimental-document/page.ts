// The page side of the case: a fake document, and foldkit's helper, which takes an event target and cancels the event
// in the dispatch stack.
/** @throws {never} */
export const fakeDocument = (): Document => new EventTarget() as unknown as Document

/** @throws {never} */
export const cancelKeydown = (target: Document, onKey: (event: KeyboardEvent) => void): void => {
  target.addEventListener("keydown", (event) => {
    event.preventDefault()
    onKey(event)
  })
}

/** @throws {never} */
export const pressKey = (target: Document, key: string): boolean => {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

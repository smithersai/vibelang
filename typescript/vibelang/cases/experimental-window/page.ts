// The page side of the case: a fake window, and foldkit's helper, which takes an event target and filters in the
// dispatch stack.
/** @throws {never} */
export const fakeWindow = (origin: string): Window =>
  Object.assign(new EventTarget(), { location: { origin } }) as unknown as Window

/** @throws {never} */
export const filterMessages = (target: Window, keep: (event: MessageEvent) => boolean, onKept: (event: MessageEvent) => void): void => {
  target.addEventListener("message", (event) => {
    if (keep(event)) onKept(event)
  })
}

/** @throws {never} */
export const postFrom = (target: Window, origin: string, data: string): void => {
  target.dispatchEvent(Object.assign(new Event("message"), { origin, data }))
}

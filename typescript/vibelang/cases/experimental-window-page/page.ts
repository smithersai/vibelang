// The page side of the case: a minimal page global, as happy-dom or jsdom gives a component test. It has the
// event constructors, an element class whose prototype a test replaces, and the animation-frame member.
class FakeKeyboardEvent extends Event {
  readonly key: string
  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, init)
    this.key = init.key ?? ""
  }
}

class FakeElement extends EventTarget {
  scrollIntoView(): void {}
}

/** @throws {never} */
export const fakePage = (): Window =>
  Object.assign(new EventTarget(), {
    document: new EventTarget(),
    KeyboardEvent: FakeKeyboardEvent,
    CustomEvent,
    Element: FakeElement,
    requestAnimationFrame: (_callback: FrameRequestCallback): number => {
      throw new Error("the test stubs requestAnimationFrame")
    }
  }) as unknown as Window

/** @module @throws {never} */
export function danger(): string {
  throw new Error("the module initializer is trusted; this function is not");
}

// Nothing may be added above the header. The claim is a MODULE-initialization
// claim, written in exactly the compact one-line form the specification prints,
// and it sits where a file-leading JSDoc always sits: immediately above the
// first statement. An implementation that reads it as `danger`'s own
// function-level `@throws {never}` certifies a function that always throws —
// by the act of writing the documented header. `danger` carries no function
// claim of its own, so every call to it must charge the panic channel.

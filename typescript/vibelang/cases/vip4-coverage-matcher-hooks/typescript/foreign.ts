export const matcher: unique symbol = ((Symbol as any).customMatcher ?? Symbol.for("Symbol.customMatcher")) as any
export class GetterPattern {
  static get [matcher](): (subject: unknown) => boolean { throw "getter" }
}
export class CallPattern {
  static [matcher](_subject: unknown): boolean { throw "call" }
}

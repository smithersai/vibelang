declare global { interface SymbolConstructor { readonly customMatcher: unique symbol } }
export declare class Foreign {}
export declare const CrossRealm: new () => object
export declare class TaggedBase {
  static [Symbol.customMatcher](subject: unknown): boolean
}
export declare class TaggedSub extends TaggedBase {}
export declare function inputs(): unknown[]

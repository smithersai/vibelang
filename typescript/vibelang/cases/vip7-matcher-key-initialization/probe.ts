const host = Symbol as SymbolConstructor & { readonly customMatcher?: symbol }
export const seen = host.customMatcher === Symbol.for("Symbol.customMatcher")

import "./version.js"
/**
 * The proposal's `Symbol.customMatcher`: a static method that decides whether
 * a subject matches. `x is M` tests its result for truthiness; an extractor
 * pattern `M(...)` accepts `false` or an iterable object of extracted values.
 * The runtime defines `Symbol.customMatcher` when the engine lacks it, as the
 * registered symbol the proposal's polyfills use, so every copy of the runtime
 * agrees. Like a well-known symbol it is non-writable, non-enumerable and
 * non-configurable; an engine's own symbol is kept (008-runtime.md, Matcher
 * symbol initialization).
 */
type SymbolWithCustomMatcher = { readonly customMatcher?: typeof Symbol.customMatcher }

if ((Symbol as unknown as SymbolWithCustomMatcher).customMatcher === undefined) {
  Object.defineProperty(Symbol, "customMatcher", { value: Symbol.for("Symbol.customMatcher") })
}
export const customMatcher: typeof Symbol.customMatcher =
  (Symbol as unknown as { readonly customMatcher: typeof Symbol.customMatcher }).customMatcher

// Public matcher-bearing declarations reference this module through the
// runtime package, including when a stock consumer has no VibeLang prelude.
declare global {
  interface SymbolConstructor {
    readonly customMatcher: unique symbol
  }
}

import "vibelang-runtime"
const protocol = Symbol.customMatcher
export function main(): unknown[] {
  const local = Symbol("local")
  let reads = 0
  const holder = { get customMatcher() { reads++; return local } }
  function parameter(Symbol: { readonly customMatcher: symbol }): boolean {
    return Symbol.customMatcher === local
  }
  const arrow = (Symbol: { readonly customMatcher: symbol }): boolean => Symbol.customMatcher === local
  const reader = {
    read(Symbol: { readonly customMatcher: symbol }): boolean { return Symbol.customMatcher === local }
  }
  function destructured({ Symbol }: { Symbol: { readonly customMatcher: symbol } }): boolean {
    return Symbol.customMatcher === local
  }
  return [typeof protocol === "symbol", parameter(holder), arrow(holder), reader.read(holder), destructured({ Symbol: holder }), reads]
}

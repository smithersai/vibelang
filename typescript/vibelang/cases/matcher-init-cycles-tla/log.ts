// The evaluation trace both twins write.
export const events: string[] = []
export function log(event: string) {
  events.push(event + (typeof (Symbol as { readonly customMatcher?: symbol }).customMatcher === "symbol" ? "" : " (no key)"))
}

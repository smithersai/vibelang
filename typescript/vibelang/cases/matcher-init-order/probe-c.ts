// Records whether Symbol.customMatcher existed when this module was evaluated.
export const seen = typeof (Symbol as { readonly customMatcher?: symbol }).customMatcher

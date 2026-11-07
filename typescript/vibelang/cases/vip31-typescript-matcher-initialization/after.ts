// An ordinary TypeScript module evaluated after the runtime initialized the key.
export const after = typeof (Symbol as { customMatcher?: symbol }).customMatcher

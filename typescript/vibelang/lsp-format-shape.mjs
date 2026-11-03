// Preserve the fixture's call, effect program and arguments across formatting.
// The contextual effect keyword and its opening brace stay on one line.
export function hasWithSpanEffectBlock(formatted) {
  return /\breturn[ \t]+try[ \t]+withSpan\s*\(\s*effect[ \t]*\{\s*return[ \t]+try[ \t]+greeting\s*\(\s*\)\s*;?\s*\}\s*,\s*"load"\s*,?\s*\)/.test(formatted)
}

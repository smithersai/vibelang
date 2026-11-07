// expect: TS2339
// rule-evidence: docs/design/src/004-match.md#class-patterns | The ambient `SymbolConstructor` augmentation is program-wide, so `.ts` files in the same TypeScript program see it too; a standalone `.ts` program without the provider does not.
// A program of TypeScript files alone, which neither holds a VibeLang source
// nor imports vibelang-runtime, has no `Symbol.customMatcher` key.
export type MatcherKey = typeof Symbol.customMatcher

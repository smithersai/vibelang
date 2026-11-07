// A TypeScript file in the same program sees the program-wide augmentation.
export interface BooleanMatcher {
  [Symbol.customMatcher](subject: unknown): boolean
}
export type MatcherKey = typeof Symbol.customMatcher

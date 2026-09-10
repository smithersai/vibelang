/**
 * Exact compiler-owned module spellings accepted at the language row boundary.
 * This data registry must not load a parser/checker into host policy code.
 * Prefix membership is never evidence that a module belongs to the compiler.
 */
export const COMPILER_INTRINSIC_SPECIFIERS: ReadonlySet<string> = new Set([
  "vibelang/context",
  "vibelang/provider",
  "vibelang/schema-runtime",
  "vibelang:exceptions",
  "vibelang:comptime",
  "vibelang:flows",
]);

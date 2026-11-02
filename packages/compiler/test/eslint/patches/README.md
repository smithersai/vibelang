# Pinned reference parser patch

The differential suite uses `@typescript-eslint/typescript-estree@8.69.0`
with TypeScript `5.9.3`. For `type X = F<<T>(x: T) => T>;`,
TypeScript's `getChildren` omits the outer `<` token. The reference node
ranges still include both angles. The Bun patch restores only missing
type-list openings from the parser's `typeArguments` and `typeParameters`
boundaries; it preserves comments, strings and actual `<<` operators.

`bun install --frozen-lockfile` applies the patch. Run
`node --test angle-tokens.test.mjs differential.test.mjs` from this directory
after changing either pin. The native compiler's independent token property
runs with `node --test test/eslint-type-angle.property.test.mjs` from
`packages/compiler`, so it also runs in `//packages:compiler-test`.
Retire the patch when the unpatched reference passes these checks.

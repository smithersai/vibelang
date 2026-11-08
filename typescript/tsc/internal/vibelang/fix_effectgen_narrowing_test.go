package vibelang

import (
	"strings"
	"testing"
)

// Where no form keeps the proof, the call alone goes through the wrapper, as
// before, and the fix gate decides: String(o.p) accepts what the guard ruled
// out. Of two calls in one statement, the first still keeps its proof.
func TestEffectGenDefectBridgeNarrowingFallsBack(t *testing.T) {
	for _, test := range []struct{ name, source, want, not string }{
		{"a yield in the guard", "export const g = (o: { readonly p?: number }, e: Effect.Effect<boolean>) => Effect.gen(function* () {\n  return (yield* e) && o.p !== undefined ? JSON.parse(String(o.p)) : 0\n})\n", "try: () => JSON.parse(String(o.p)), catch", "= o.p\n"},
		{"a call before the read", "const touch = (): number => 1\nexport const g = (o: { readonly p?: string }) => Effect.gen(function* () {\n  if (!o.p) return 0\n  return touch() + JSON.parse(o.p)\n})\n", "try: () => JSON.parse(o.p), catch", "= o.p\n"},
		{"two calls in one statement", "export const g = (o: { readonly p?: string; readonly q?: string }) => Effect.gen(function* () {\n  if (!o.p || !o.q) return 0\n  return JSON.parse(o.p) + JSON.parse(o.q)\n})\n", "try: () => JSON.parse(o.q), catch", "= o.q\n"},
		// a call that may throw stays in the wrapper with the call it feeds
		{"a throwing call over the read", "export const g = (o: { readonly p?: string }) => Effect.gen(function* () {\n  if (!o.p) return 0\n  return JSON.parse(JSON.parse(o.p))\n})\n", "try: () => JSON.parse(JSON.parse(o.p))", "= JSON.parse(o.p)"},
		{"a loop head", "export const g = (o: { readonly p?: string }) => Effect.gen(function* () {\n  if (!o.p) return 0\n  for (let i = JSON.parse(o.p); i > 0; i--) yield* Effect.void\n  return 1\n})\n", "let i = try Effect.orDie(Effect.try({ try: () => JSON.parse(o.p), catch", "= o.p\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := effectGenQuickFix(t, test.source)
			if !ok {
				t.Fatalf("no quick fix; notes: %s", effectGenNotes(t, test.source))
			}
			if !strings.Contains(got, test.want) || strings.Contains(got, test.not) {
				t.Fatalf("got:\n%s\nwant the call alone in the wrapper, %q", got, test.want)
			}
		})
	}
}

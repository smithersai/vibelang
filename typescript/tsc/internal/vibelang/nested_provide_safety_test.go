package vibelang

import "testing"

// VIP-12 lowers each block to Effect.provide. Combining blocks moves an inner
// provider expression before the outer layer builds, and can also parallelize
// independent layer builds. Keep the nesting instead of offering that rewrite.
func TestNestedProvideDoesNotOfferUnsafeMerge(t *testing.T) {
	prefix := "service A { n: number }\nservice B { n: number }\nconst LA = Layer.succeed(A, { n: 1 })\nconst LB: Layer.Layer<B, never, A> = Layer.effect(B, Effect.map(A, a => ({ n: a.n })))\nconst outer = () => LA\nconst inner = () => LB\nexport effect function f() { "
	for _, body := range []string{
		"provide LA { provide LA { return 1 } }",
		"provide LA { provide LB { return 1 } }",
		"provide outer() { provide inner() { return 1 } }",
	} {
		t.Run(body, func(t *testing.T) {
			source := prefix + body + " }"
			program, file, _, _ := editorProgram(t, source)
			reported := false
			for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
				reported = reported || diagnostic.Code() == EK4808.Code
			}
			if !reported {
				t.Fatal("missing nested-provide guidance")
			}
			proposal := fileFixes(t.Context(), program, file, nil, []int32{EK4808.Code})
			if got := proposal.text(); got != source {
				t.Fatalf("unsafe nested-provider merge offered:\ngot:\n%s\nwant unchanged:\n%s", got, source)
			}
		})
	}
}

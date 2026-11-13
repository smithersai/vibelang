package vibelang

import (
	"testing"
)

// A comment between stages has no unambiguous place in a rewritten chain.
func TestOptionPipeRefusals(t *testing.T) {
	for _, test := range []struct{ name, source, why string }{
		{"a comment between stages", "export const label = (o: Option.Option<string>) =>\n  pipe(\n    o,\n    // shout\n    Option.map((s) => s.toUpperCase()),\n  )\n", "a comment stands between"},
	} {
		t.Run(test.name, func(t *testing.T) {
			assertFormRefusal(t, test.source, 4840, test.why)
		})
	}
}

// A pipe with a stage of another module is no Option pipeline.
func TestOptionPipeNotReported(t *testing.T) {
	for _, source := range []string{
		"export const f = (o: Option.Option<string>) => pipe(o, Option.getOrElse(() => \"\"), (s) => s.length)\n",
		"export const g = (n: number) => pipe(n, (x) => x + 1)\n",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() == diagnosticSource && d.Code() == EK4840.Code {
				t.Errorf("unexpected EK4840 in %s: %s", source, d.String())
			}
		}
	}
}

// rule-evidence: docs/design/src/900-appendices.md#85e5486645c81a46
// Chapter 900: EK4840 Option pipeline warning and fix

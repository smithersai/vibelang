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
			assertFormRefusal(t, "// @vibelang-diagnostics EK4840:warning\n"+test.source, 4840, test.why)
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

// A default compile of an Option pipeline is quiet: EK4840 names the retired
// receiver-method form, so it is off unless a project enables it.
func TestOptionPipeOffByDefault(t *testing.T) {
	for _, source := range []string{
		"export const name = (nick: Option.Option<string>) => pipe(nick, Option.map((s) => s.trim()), Option.getOrElse(() => \"anon\"))\n",
		"export const next = (o: Option.Option<number>) => o.pipe(Option.map((n) => n + 1), Option.getOrNull)\n",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() == diagnosticSource && d.Code() == EK4840.Code {
				t.Errorf("default compile reports EK4840 in %s: %s", source, d.String())
			}
		}
		program, file, _, _ = editorProgram(t, "// @vibelang-diagnostics EK4840:warning\n"+source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			found = found || (d.Source() == diagnosticSource && d.Code() == EK4840.Code)
		}
		if !found {
			t.Errorf("enabled EK4840 is missing in %s", source)
		}
	}
}

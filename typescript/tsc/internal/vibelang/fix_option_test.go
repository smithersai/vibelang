package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// D473: EK4840's quick fix writes an Option pipeline with Option's methods,
// through the same data-first functions, in the same order.
func TestOptionPipeQuickFixes(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"pipe", "export const name = (nick: Option.Option<string>) => pipe(nick, Option.map((s) => s.trim()), Option.getOrElse(() => \"anon\"))\n",
			"export const name = (nick: Option.Option<string>) => nick.map((s) => s.trim()).getOrElse(() => \"anon\")\n"},
		{"the pipe method", "export const next = (o: Option.Option<number>) => o.pipe(Option.map((n) => n + 1))\n",
			"export const next = (o: Option.Option<number>) => o.map((n) => n + 1)\n"},
		{"a value that is not an Option", "export const size = (id: string | null) => pipe(id, Option.fromNullishOr, Option.map((s) => s.length))\n",
			"export const size = (id: string | null) => Option.fromNullishOr(id).map((s) => s.length)\n"},
		// The foldkit run's pipeline, which its agent rewrote by hand.
		{"a predicate", "const isTagged = (x: unknown): x is { _tag: string } => typeof x === \"object\" && x !== null && \"_tag\" in x\nexport const tagOf = (current: unknown) =>\n  pipe(\n    current,\n    Option.liftPredicate(isTagged),\n    Option.map(({ _tag }) => _tag),\n  )\n",
			"const isTagged = (x: unknown): x is { _tag: string } => typeof x === \"object\" && x !== null && \"_tag\" in x\nexport const tagOf = (current: unknown) =>\n  Option.liftPredicate(current, isTagged)\n    .map(({ _tag }) => _tag)\n"},
		{"a function stage", "export const value = (o: Option.Option<number>) => pipe(o, Option.getOrNull)\n",
			"export const value = (o: Option.Option<number>) => o.getOrNull()\n"},
		{"two names of one import", "import { Array as Arr, Option, pipe } from \"effect\"\nexport const first = (xs: ReadonlyArray<number>) => pipe(Arr.get(xs, 0), Option.map((n) => n + 1), Option.getOrNull)\n",
			"import { Array as Arr } from \"effect\"\nexport const first = (xs: ReadonlyArray<number>) => Arr.get(xs, 0).map((n) => n + 1).getOrNull()\n"},
		{"two names of a list on lines", "import {\n  Array as Arr,\n  Option,\n  pipe,\n} from \"effect\"\nexport const first = (xs: ReadonlyArray<number>) => pipe(Arr.get(xs, 0), Option.getOrNull)\n",
			"import {\n  Array as Arr,\n} from \"effect\"\nexport const first = (xs: ReadonlyArray<number>) => Arr.get(xs, 0).getOrNull()\n"},
		{"lines without comments", "export const label = (o: Option.Option<string>) =>\n  pipe(\n    o,\n    Option.map((s) => s.toUpperCase()),\n    Option.getOrElse(() => \"\"),\n  )\n",
			"export const label = (o: Option.Option<string>) =>\n  o\n    .map((s) => s.toUpperCase())\n    .getOrElse(() => \"\")\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := applyQuickFix(t, test.source, EK4840.Code)
			if got != test.want {
				t.Fatalf("edited source differs:\ngot:\n%s\nwant:\n%s", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && d.Code() == EK4840.Code {
					t.Errorf("the fixed source reports %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

// A comment between stages has no unambiguous place in a rewritten chain.
// Effectful stage arguments are covered by TestOptionFactoryHoistFoldkit.
func TestOptionPipeRefusals(t *testing.T) {
	for _, test := range []struct{ name, source, why string }{
		{"a comment between stages", "export const label = (o: Option.Option<string>) =>\n  pipe(\n    o,\n    // shout\n    Option.map((s) => s.toUpperCase()),\n  )\n", "a comment stands between"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			var found *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4840.Code {
					found = d
				}
			}
			if found == nil {
				t.Fatalf("missing EK4840 in:\n%s", test.source)
			}
			notes := ""
			for _, chained := range found.MessageChain() {
				notes += chained.String() + "\n"
			}
			if !strings.Contains(notes, "No quick fix") || !strings.Contains(notes, test.why) {
				t.Fatalf("EK4840's note %q does not say %q", notes, test.why)
			}
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

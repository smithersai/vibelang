package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-5 catches an Effect, not a call of that value. D24's Config value
// calls ran in the old language; the VIP migration must keep the catch's
// ownership of the run, without putting try before the catch head.
func TestFixVIPConfigValueCatchHeads(t *testing.T) {
	for _, c := range []struct{ name, declarations, head, result, fallback string }{
		{"stored-config", `const Port = Config.String("FOLDKIT_PROBE")`, "Port", "string", `""`},
		{"config-factory", "", `Config.option(Config.String("FOLDKIT_PROBE"))`, "Option.Option<string>", "Option.none<string>()"},
		{"effect-factory", "", "Effect.succeed(7)", "number", "0"},
	} {
		t.Run(c.name, func(t *testing.T) {
			prefix := "import { Config } from \"effect\"\n" + c.declarations + "\nexport const program: " + c.result + "!! = effect {\n  return "
			source := prefix + c.head + "() catch () => " + c.fallback + "\n}\n"
			want := prefix + "(" + c.head + ") catch () => " + c.fallback + "\n}\n"
			checked, file, _, _ := editorProgram(t, source)
			invalidCalls := 0
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), file), checked.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == 2307 || d.Code() == 2304 || d.Code() == 2339 {
					t.Fatalf("fixture dependency/type error: %s", d.String())
				}
				if d.Code() == 2349 {
					invalidCalls++
				}
			}
			if invalidCalls != 1 {
				t.Fatalf("want the one legacy non-callable-value error, got %d", invalidCalls)
			}
			fixed, name := fixVIPOnlySource(t, source)
			if fixed.Err != nil {
				t.Fatal(fixed.Err)
			}
			if len(fixed.Refused) != 0 {
				t.Fatalf("refused %+v", fixed.Refused)
			}
			got := source
			if f := fixed.Files[name]; f != nil {
				got = f.Text
			}
			var report strings.Builder
			fixed.Report(&report, func(tspath.RootedFilePath) string { return "main.vibe" })
			if !strings.Contains(report.String(), "1 fix (Effect value call ×1)") {
				t.Fatalf("migration receipt must count the applied value-call fix: %s", report.String())
			}
			if got != want {
				t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s", got, want)
			}
			if strings.Contains(got, "try "+c.head) {
				t.Fatal("catch head must remain a held Effect for catch to run")
			}
			compiled, rewritten, _, _ := editorProgram(t, got)
			for _, d := range append(compiled.GetSyntacticDiagnostics(t.Context(), rewritten), compiled.GetSemanticDiagnostics(t.Context(), rewritten)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("rewrite does not compile: %s", d.String())
				}
			}
			again, _ := fixVIPOnlySource(t, want)
			if again.Err != nil || len(again.Refused) != 0 || len(again.Files) != 0 {
				t.Fatalf("not a fixed point: %+v", again)
			}
		})
	}
}

// Service-tag migration clients keep the existing four-result protocol.
// They append the opening text themselves; the helper's precise-offset
// variant must not break those clients or lose a held catch operand.
func TestFixVIPValueCallClientProtocol(t *testing.T) {
	for _, c := range []struct{ name, declarations, head, fallback string }{
		{"stored-config", "const Port = Config.String(\"FOLDKIT_PROBE\")", "Port", "\"\""},
		{"config-factory", "", "Config.option(Config.String(\"FOLDKIT_PROBE\"))", "Option.none<string>()"},
		{"effect-factory", "", "Effect.succeed(7)", "0"},
	} {
		t.Run(c.name, func(t *testing.T) {
			prefix := "import { Config } from \"effect\"\n" + c.declarations + "\nexport effect function program() { return "
			source := prefix + c.head + "() catch () => " + c.fallback + " }\n"
			program, file, _, _ := editorProgram(t, source)
			program.GetSemanticDiagnostics(t.Context(), file)
			checker, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			var call *ast.Node
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsCallExpression(node) && source[scanner.SkipTrivia(source, node.Pos()):node.End()] == c.head+"()" {
					call = node
					return false
				}
				return node.ForEachChild(visit)
			}
			visit(file.AsNode())
			if call == nil {
				t.Fatal("missing real value call")
			}
			at, open, edits, ok := effectValueCallEdits(analyzerFor(checker), file, call)
			if !ok {
				t.Fatal("four-result caller did not receive the catch-head repair")
			}
			edits = append(edits, sourceEdit{at, at, open})
			got := applyEdits(source, edits)
			want := prefix + "(" + c.head + ") catch () => " + c.fallback + " }\n"
			if got != want {
				t.Fatalf("four-result caller wrote\n%s\nwant\n%s", got, want)
			}
		})
	}
}

package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Chapter 004, Class patterns: the editor offers the bare and singleton
// extractor alternatives of EK0703; automatic fixes preserve matching.
func TestExtractorArityEditorActions(t *testing.T) {
	for _, test := range []struct {
		name, declaration, subject, pattern, body string
		want                                      int
	}{
		{"empty", "error E { id: string }", "unknown", "E()", "1", 2},
		{"pair", "error E { id: string }", "unknown", "E(let a, let b)", "1", 2},
		{"comments", "error E { id: string }", "unknown", "E /* matcher */ (/* first */ let a, /* second */ let b)", "1", 2},
		{"line-comment", "error E { id: string }", "unknown", "E(// capture\nlet a, let b)", "1", 2},
		{"alias", "error E { id: string }; const Alias = E", "unknown", "Alias()", "1", 2},
		{"some", "", "Option.Option<number>", "Option.Some()", "1", 2},
		{"none", "", "Option.Option<number>", "Option.None(let a)", "1", 1},
		{"live-capture", "error E { id: string }", "unknown", "E(let a, let b)", "a", 0},
		{"live-guard", "error E { id: string }", "unknown", "E(let a, let b) and if (a !== null)", "1", 0},
	} {
		for _, crlf := range []bool{false, true} {
			t.Run(test.name+map[bool]string{false: "/lf", true: "/crlf"}[crlf], func(t *testing.T) {
				source := "// café 😀\n" + test.declaration + "\nexport function f(s: " + test.subject + ", e: unknown) { return match(s) { when " + test.pattern + ": " + test.body + "; default: 0; } }\n"
				if crlf {
					source = strings.ReplaceAll(source, "\n", "\r\n")
				}
				program, file, service, converters := editorProgram(t, source)
				found, actions := false, 0
				for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
					if diagnostic.Code() != EK0703.Code {
						continue
					}
					found = true
					d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
					only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
					response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
						TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
						Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
					})
					if err != nil {
						t.Fatal(err)
					}
					if response.CommandOrCodeActionArray == nil {
						continue
					}
					for _, item := range *response.CommandOrCodeActionArray {
						a := item.CodeAction
						if a == nil || a.Edit == nil || a.Edit.Changes == nil {
							continue
						}
						if !strings.HasPrefix(a.Title, "Test ") && !strings.HasPrefix(a.Title, "Extract one value") {
							continue
						}
						actions++
						after := applyEditorEdits(t, file, converters, (*a.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
						for _, comment := range []string{"// café 😀", "/* matcher */", "/* first */", "/* second */", "// capture"} {
							if strings.Contains(source, comment) && !strings.Contains(after, comment) {
								t.Errorf("lost comment %q", comment)
							}
						}
						if strings.Contains(a.Title, "Extract one value") && !strings.Contains(after, "(let e$1)") {
							t.Errorf("capture is not fresh: %s", after)
						}
						next, nextFile, _, _ := editorProgram(t, after)
						for _, d := range append(next.GetSyntacticDiagnostics(t.Context(), nextFile), next.GetSemanticDiagnostics(t.Context(), nextFile)...) {
							if d.Code() == EK0703.Code || d.Category() == diagnostics.CategoryError {
								t.Errorf("repair left %s\n%s", d.String(), after)
							}
						}
					}
				}
				if !found {
					t.Fatal("missing EK0703 witness")
				}
				if actions != test.want {
					t.Errorf("got %d actions, want %d", actions, test.want)
				}
				if slices.Contains(tsFormFixCodes, EK0703.Code) || slices.Contains(vipMigrationFixCodes, EK0703.Code) {
					t.Fatal("arity choices must not be automatic migrations")
				}
				if got := fileFixes(t.Context(), program, file, nil, tsFormFixCodes).text(); got != source {
					t.Fatalf("--fix changed a never-matching arm:\n%s", got)
				}
			})
		}
	}
}

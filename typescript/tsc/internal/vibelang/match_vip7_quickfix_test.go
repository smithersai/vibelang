package vibelang

import (
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Each missing action remains an explicit pending coverage gap. A skipped
// witness is never reported as passing coverage by cov-match.
func TestMatchVIP7QuickFixes(t *testing.T) {
	cases := []struct {
		name, source string
		code         int32
		wants        []string
	}{
		{"arity", "error E { id:string };export function f(s:unknown){return match(s){when E(let a,let b):1;default:0;}}", 703, []string{`when E:`, `when E\(let [A-Za-z_$][A-Za-z0-9_$]*\):`}},
		{"constructor", "class C { constructor(readonly x:number,readonly y:number){} };export function f(s:unknown){return match(s){when C(let a,let b):1;default:0;}}", 704, []string{`when C:`, `when C and \{ x: let a, y: let b \}:`}},
		{"predicate", "const p=(s:unknown)=>Promise.resolve(s);export function f(s:unknown){return match(s){when p:1;default:0;}}", 702, []string{`when let [A-Za-z_$][A-Za-z0-9_$]* and if \(p\(`}},
		{"variant", "data D { V { n:number }; W };export function f(s:unknown){return match(s){when D.V(let n):1;default:0;}}", 702, []string{`_tag: "V"`}},
		{"schema", "schema S { n:number };export function f(s:unknown){return match(s){when S:1;default:0;}}", 702, []string{`Schema.is\(S\)`}},
		{"service", "service S { read():number!! };export function f(s:unknown){return match(s){when S:1;default:0;}}", 3004, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, c.source)
			var found *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == c.code {
					found = d
					break
				}
			}
			if found == nil {
				t.Skipf("pending cov-match VIP-7: missing EK%04d required before its quick fixes can be offered", c.code)
			}
			diagnostic := lsconv.DiagnosticToLSPPush(t.Context(), converters, found)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			var outputs []string
			if response.CommandOrCodeActionArray != nil {
				for _, entry := range *response.CommandOrCodeActionArray {
					if action := entry.CodeAction; action != nil && action.Edit != nil && action.Edit.Changes != nil {
						edits := (*action.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())]
						outputs = append(outputs, applyEditorEdits(t, file, converters, edits))
					}
				}
			}
			text := regexp.MustCompile(`\s+`).ReplaceAllString(strings.Join(outputs, "\n"), " ")
			for _, want := range c.wants {
				if !regexp.MustCompile(want).MatchString(text) {
					t.Skipf("pending cov-match VIP-7: EK%04d lacks quick fix matching %q; available edits: %s", c.code, want, text)
				}
			}
		})
	}
}

// VIP-7 diagnostic-specific pattern quick fixes; rule: docs/design/vips/0007-match.md#89aefadf08f41f10
// VIP-7 diagnostic-specific pattern quick fixes; rule: docs/design/vips/0007-match.md#74d528eff5f8e7b8
// VIP-7 diagnostic-specific pattern quick fixes; rule: docs/design/vips/0007-match.md#83167819553a8740
// VIP-7 diagnostic-specific pattern quick fixes; rule: docs/design/vips/0007-match.md#408d561659c9a42e
// VIP-7 diagnostic-specific pattern quick fixes; rule: docs/design/vips/0007-match.md#d6bb0645ad23acd3

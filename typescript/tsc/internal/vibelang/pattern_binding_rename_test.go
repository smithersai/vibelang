package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-7 shorthand binds the named property; VIP-34 editor rewrites preserve
// meaning. The explicit key is the same separation TypeScript's destructuring
// rename writes as { value: fresh }.
func TestPatternBindingRename(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"variant", `data D { V { value: number } }; function pick(x:D){return match(x){when D.V { let value }: value;}}`, `when D.V { value: let fresh }`},
		{"const", `function pick(x:{value:number}){return match(x){when { const value }: value;default:0;}}`, `{ value: const fresh }`},
		{"is", `function pick(x:{value:number}){if(x is {let value})return value;return 0}`, `{value: let fresh}`},
		{"comments", "function pick(x:{value:number}){return match(x){when {let /* keep */ value}:value;default:0;}}", `{value: let /* keep */ fresh}`},
		{"second field", `function pick(x:{a:number,value:number}){return match(x){when {a:1, let value}:value;default:0;}}`, `{a:1, value: let fresh}`},
		{"punctuation in earlier string", `function pick(x:{a:string,value:number}){return match(x){when {a:"[", let value}:value;default:0;}}`, `{a:"[", value: let fresh}`},
		{"nested shorthand", `function pick(x:{inner:{value:number}}){return match(x){when {inner:{let value}}:value;default:0;}}`, `{inner:{value: let fresh}}`},
		{"explicit", `function pick(x:{value:number}){return match(x){when {value:let value}:value;default:0;}}`, `{value:let fresh}`},
		{"array", `function pick(x:number[]){return match(x){when [let value]:value;default:0;}}`, `[let fresh]`},
		{"ordinary block", `function pick(){let value=1;return value}`, `{let fresh=1;return fresh}`},
		{"TypeScript twin", `function pick(x:{value:number}){const {value}=x;return value}`, `{value: fresh}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, service, converters := editorProgram(t, tc.source)
			offset := strings.LastIndex(tc.source, "value")
			pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "fresh"}, nil)
			if err != nil || response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
				t.Fatalf("rename: %v %v", response, err)
			}
			after := applyEditorEdits(t, file, converters, (*response.WorkspaceEdit.Changes)[uri])
			if !strings.Contains(after, tc.want) {
				t.Fatalf("want %q after rename, got %s", tc.want, after)
			}
			p, f, _, _ := editorProgram(t, after)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("renamed diagnostic: %s", d.String())
				}
			}
		})
	}
}

// Keep the conformance census witness covered from both rename origins. The
// property key stays value even when the exported entry function binds fresh.
func TestPatternBindingRenameCensus(t *testing.T) {
	const source = "data D { V { value: number } }\nexport function main(x: D) { return match (x) { when D.V { let value }: value; } }\n"
	const want = "data D { V { value: number } }\nexport function main(x: D) { return match (x) { when D.V { value: let fresh }: fresh; } }\n"
	for _, origin := range []struct {
		name   string
		offset int
	}{
		{"binder", strings.Index(source, "let value") + len("let ")},
		{"use", strings.LastIndex(source, "value")},
	} {
		t.Run(origin.name, func(t *testing.T) {
			_, file, service, converters := editorProgram(t, source)
			pos, _ := converters.ToLSPPosition(file, core.TextPos(origin.offset))
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "fresh"}, nil)
			if err != nil || response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
				t.Fatalf("rename: %v %v", response, err)
			}
			after := applyEditorEdits(t, file, converters, (*response.WorkspaceEdit.Changes)[uri])
			if after != want {
				t.Fatalf("want:\n%s\ngot:\n%s", want, after)
			}
			p, f, _, _ := editorProgram(t, after)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("renamed diagnostic: %s", d.String())
				}
			}
		})
	}
}

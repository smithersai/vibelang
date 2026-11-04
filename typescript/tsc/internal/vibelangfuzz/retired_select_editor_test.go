package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const retiredSelectEditorQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."

func TestRetiredSelectEditorQuoted(t *testing.T) {
	if !strings.Contains(SpecText("000-intro.md"), retiredSelectEditorQuote) {
		t.Fatalf("intro no longer says %q", retiredSelectEditorQuote)
	}
}

// VIP-34/LSP 3.17: source identifiers must keep their symbol identity during
// recovery. This checks editor recovery, not admission or a runtime meaning
// for retired select. The TypeScript counterpart of each ordinary call is
// also covered by TestRetiredSelectEditorServices.
func FuzzRetiredSelectEditorTokens(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"binding", "bare", "default", "nested", "parenthesized", "multiple", "body", "default-first", "default-middle", "empty-binding"} {
		f.Add(key, byte(0))
		f.Add(key, byte(7))
	}
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestRetiredSelectEditorQuoted(t)
		name := fmt.Sprintf("callee%d", variant)
		sep := []string{" ", "\n", " /* keep */ ", "\r\n"}[int(variant)%4]
		call := name + "()"
		arm := "case const n = " + call + ": return n"
		switch key {
		case "bare":
			arm = "case " + call + ": break"
		case "default":
			arm += "; default: return " + call
		case "nested":
			arm = "case const n = (true ? " + call + " : " + call + "): return n"
		case "parenthesized":
			arm = "case const n = (" + call + "): return n"
		case "empty-binding":
			arm = "case const n = " + call + ":"
			if variant&1 != 0 {
				arm += " case const m = " + call + ": return m"
			}
		case "default-first":
			arm = "default: " + call + "; break; " + arm
		case "default-middle":
			arm += "; default: " + call + "; break; case const m = " + call + ": " + call + "; return m"
		case "body":
			arm = "case const n = " + call + ": " + call + "; return n; case const m = " + call + ": return m"
		case "multiple":
			arm += "; case const m = " + call + ": return m"
		default:
			key = "binding"
		}
		source := "function " + name + "() { return 1 }" + sep + "export function main() { select {" + sep + arm + sep + "} }"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		var visit func(*ast.Node) bool
		count := 0
		visit = func(n *ast.Node) bool {
			if ast.IsIdentifier(n) && (n.Text() == name || n.Text() == "n" || n.Text() == "m") && n.Flags&ast.NodeFlagsReparsed == 0 {
				if n.Text() == name {
					count++
				}
				at := n.End() - len(n.Text())
				if got := astnav.GetTouchingPropertyName(file, at); got != n {
					Gap(t, "FuzzRetiredSelectEditorTokens", key, "VIP-34, LSP 3.17; %s: token at %d is %s, want the written %s in %s", retiredSelectEditorQuote, at, got.Kind, n.Text(), source)
				}
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		if count < 2 {
			t.Fatalf("generator lost declaration or call: %s", source)
		}
	})
}

func TestRetiredSelectEditorServices(t *testing.T) {
	w := NewWorkspace(t)
	for _, body := range []string{
		"select { case const n = f(): }",
		"select { default: f(); break; case const n = f(): f(); return n }",
		"select { case const n = f(): return n; default: f(); break; case const m = f(): f(); return m }",
		"select { case const n = f(): return n }",
		"select { case f(): break; case f(): break; default: f() }",
		"select { case const n = (f()): return n; default: return f() }",
		"select { case const n = f(): f(); return n; case const m = f(): return m }",
		"return f()",
	} {
		t.Run(body, func(t *testing.T) {
			file := "main.vibe"
			if body == "return f()" {
				file = "main.ts"
			}
			source := "function f() {}\nexport function main() { " + body + " }\n"
			files := map[string]string{file: source}
			r := toolsCompile(t, w, consistencyTarget, files)
			t.Logf("baseline diagnostics: %v", Keys(r.Dir, r.Diagnostics))
			retired := false
			for _, diagnostic := range r.Diagnostics {
				retired = retired || IsEK(diagnostic) && diagnostic.Code() == 4607
			}
			if strings.HasPrefix(body, "select") && !retired {
				t.Fatal("editor recovery must retain the retired select diagnostic EK4607")
			}
			defer r.Remove()
			c := &consistency{t: t, ctx: t.Context(), w: w, main: file, archive: Archive(files)}
			p := c.project(r, files)
			c.before = p
			declaration := strings.Index(source, "f()")
			refs, ok := c.references(p, file, declaration)
			if !ok {
				t.Fatal("references failed")
			}
			for at := declaration; at >= 0; {
				want := consistencySpan{file, at, at + 1}
				if !refs[want] {
					t.Errorf("references omit %v: %v", want, refs)
				}
				hover, err := p.service.ProvideHover(t.Context(), &lsproto.HoverParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: p.uri(file)}, Position: p.position(file, at)})
				if err != nil || hover.Hover == nil {
					t.Errorf("hover missing at %d: %v", at, err)
				}
				next := strings.Index(source[at+1:], "f()")
				if next < 0 {
					break
				}
				at += next + 1
			}
			rename, err := p.service.ProvideRename(t.Context(), &lsproto.RenameParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: p.uri(file)},
				Position:     p.position(file, declaration), NewName: "renamedCallee",
			}, nil)
			if err != nil || rename.WorkspaceEdit == nil {
				t.Fatalf("rename failed: %v", err)
			}
			edited, ok := c.apply(p, "rename", "retired-select", "renamedCallee", rename.WorkspaceEdit)
			if !ok || strings.Contains(edited.files[file], "f()") {
				t.Fatalf("rename left a call unchanged: %v", edited)
			}
			after := toolsCompile(t, w, consistencyTarget, edited.files)
			defer after.Remove()
			if diff, _ := consistencyCountDiff(consistencyDiagnosticCounts(r, nil), consistencyDiagnosticCounts(after, nil), false); len(diff) > 0 {
				t.Errorf("rename changes diagnostics: %v", diff)
			}
			c.checkCallHierarchy()
		})
	}
}

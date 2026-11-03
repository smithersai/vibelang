package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestPipeStatementQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "4. **Existing tools work.**") {
		t.Fatal("tooling contract changed")
	}
}

// D372: moving an argument to the head of a pipe preserves its expression
// context, parses, and introduces no diagnostic. Retain object/class witnesses.
func FuzzPipeStatement(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"object", "nested", "getter", "class", "parenthesized", "console-statement", "console-branch"} {
		f.Add(key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice byte) {
		expr := "{a:1}"
		switch key {
		case "nested":
			expr = "{a:{b:2}}"
		case "getter":
			expr = "{get value(){return 1}}"
		case "class":
			expr = "class {}"
		case "parenthesized":
			expr = "({a:1})"
		}
		prefix := ""
		if choice&1 != 0 {
			prefix = "const result = "
		}
		padding := strings.Repeat("// padding\n", int(choice>>1)%4)
		source := fmt.Sprintf("function f(x:unknown){return x}; function g(x:unknown){return x};\n%s%sf(g(%s))", padding, prefix, expr)
		marker := "f(g("
		// Retain the census's built-in callees and function-body statement
		// context, plus an unbraced branch where a block changes the parse.
		census := key == "console-statement" || key == "console-branch"
		if census {
			branch := ""
			if key == "console-branch" {
				branch = "if (true) "
				prefix = ""
			}
			source = fmt.Sprintf("export function f() {\n%s  %s%sConsole.log(String({ a: 1 }))\n}\n", padding, branch, prefix)
			marker = "Console.log"
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzEditor", files)
		defer r.Remove()
		for _, d := range r.Diagnostics {
			// The exact census statement already reports a discarded Effect.
			// toolsAddedErrors below still rejects every added error occurrence.
			if d.Category() == diagnostics.CategoryError && !(census && d.Source() == "EK" && d.Code() == 4801) {
				t.Fatalf("input errors: %v", Keys(r.Dir, r.Diagnostics))
			}
		}
		file := r.SourceFile("main.vibe")
		service, conv := toolsService(w, r.Program, toolsFileName(r.Dir, "main.vibe"))
		pos, _ := conv.ToLSPPosition(file, core.TextPos(strings.LastIndex(source, marker)))
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: toolsURI(r.Dir, "main.vibe")}, Range: lsproto.Range{Start: pos, End: pos}, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}}})
		if err != nil {
			t.Fatal(err)
		}
		if response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				a := item.CodeAction
				if a == nil || a.Title != "Convert to a pipe" || a.Edit == nil {
					continue
				}
				edits, ok := toolsWorkspaceEdits(a.Edit)
				if !ok {
					t.Fatal("unsupported edit")
				}
				fixed := map[string]string{"main.vibe": source}
				for uri, changes := range edits {
					if uri != toolsURI(r.Dir, "main.vibe") {
						t.Fatalf("unexpected edited file: %s", uri)
					}
					after, _, err := toolsApply(source, changes)
					if err != nil {
						t.Fatal(err)
					}
					if syntax := toolsSyntaxError("main.vibe", after); syntax != "" {
						t.Fatalf("pipe syntax: %s\n%s", syntax, after)
					}
					fixed["main.vibe"] = after
				}
				after := toolsCompile(t, w, "FuzzEditor", fixed)
				defer after.Remove()
				if added := toolsAddedErrors(r, after); len(added) > 0 {
					t.Fatalf("new pipe errors: %v\n%s", added, fixed["main.vibe"])
				}
				return
			}
		}
		t.Fatal("missing pipe action")
	})
}

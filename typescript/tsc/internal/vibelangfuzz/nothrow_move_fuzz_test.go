package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Chapter 003, Quick fixes: "move the code to a .ts file"; "An exported function of a published package
// offers the .ts fix first, because effect changes its declaration." The generator varies declaration kind,
// captured cells, publication status and filename collisions. A safe move preserves the exact TypeScript body,
// creates without overwriting, keeps the local binding/re-export, and removes EK0401 without new errors.
var nothrowMoveQuotes = []string{
	"or move the code to a `.ts` file.",
	"An exported function of a published package offers the `.ts` fix first, because `effect` changes its declaration.",
}

func TestNothrowMoveQuoted(t *testing.T) {
	for _, quote := range nothrowMoveQuotes {
		if !strings.Contains(SpecText("003-failures.md"), quote) {
			t.Fatalf("chapter 3 no longer says %q", quote)
		}
	}
}

func FuzzNothrowMove(f *testing.F) {
	startShortBudget(f)
	for index, key := range []string{"function", "generator", "constructor", "accessor", "arrow", "function-expression", "overload", "class-namespace", "function-namespace"} {
		f.Add(key, int8(index), true, false, false)
		f.Add(key, int8(-1), false, false, true)
	}
	f.Add("function", int8(7), true, true, false)
	f.Add("accessor", int8(7), true, true, true)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, value int8, published, capture, collision bool) {
		toolsGuard(t, "FuzzNothrowMove", func() {
			if !strings.Contains(SpecText("003-failures.md"), "Quick fixes, in order:") {
				t.Fatal("missing chapter 3 quick-fix authority")
			}
			name := "f"
			operand := fmt.Sprint(value)
			prefix := ""
			if capture {
				prefix = "const secret = 7;\n"
				operand = "secret"
				if value&1 != 0 {
					operand = "{ secret }"
				}
			}
			var declaration string
			kind := 0
			for index, name := range []string{"function", "generator", "constructor", "accessor", "arrow", "function-expression", "overload", "class-namespace", "function-namespace"} {
				if key == name {
					kind = index
				}
			}
			if key != "function" && key != "generator" && key != "constructor" && key != "accessor" && key != "arrow" && key != "function-expression" && key != "overload" && key != "class-namespace" && key != "function-namespace" && len(key) > 0 {
				kind = int(key[0]) % 9
			}
			switch kind {
			case 0:
				declaration = fmt.Sprintf("export function %s(): number { throw %s }", name, operand)
			case 1:
				declaration = fmt.Sprintf("export function* %s(): Generator<number> { yield 1; throw %s }", name, operand)
			case 2:
				declaration = fmt.Sprintf("export class %s { constructor() { throw %s } }", name, operand)
			case 3:
				declaration = fmt.Sprintf("export class %s { get value(): number { throw %s } }", name, operand)
			case 4:
				declaration = fmt.Sprintf("export const %s = (): number => { throw %s }", name, operand)
			case 5:
				declaration = fmt.Sprintf("export const %s = function(): number { throw %s }", name, operand)
			case 6:
				declaration = fmt.Sprintf("export function %s(value: string): number; export function %s(value: string): number { throw %s }", name, name, operand)
				if value&1 != 0 {
					declaration = fmt.Sprintf("export function %s(value: string): number; export function %s(value: number): number; export function %s(value: string | number): number { throw %s }", name, name, name, operand)
				}
			case 7:
				declaration = fmt.Sprintf("export class %s { constructor() { throw %s } } export namespace %s { export const extra = 1 }", name, operand, name)
			case 8:
				declaration = fmt.Sprintf("export function %s(): number { throw %s }; export namespace %s { export const tag = 1 }", name, operand, name)
			}
			files := map[string]string{"main.vibe": prefix + declaration, "package.json": fmt.Sprintf(`{"name":"nothrow-move","type":"module","private":%t}`, !published)}
			if collision {
				files["f.ts"] = "export const untouched = 42\n"
			}
			r := toolsCompile(t, w, "FuzzNothrowMove", files)
			defer r.Remove()
			service, _ := toolsService(w, toolsProgram(w, r.Dir), toolsFileName(r.Dir, "main.vibe"))
			uri := toolsURI(r.Dir, "main.vibe")
			diags, err := toolsDiagnostics(t.Context(), service, uri)
			if err != nil {
				t.Fatal(err)
			}
			var diag *lsproto.Diagnostic
			for _, d := range diags {
				code, source := toolsDiagnosticCode(d)
				if source == "EK" && code == 401 {
					diag = d
					break
				}
			}
			if diag == nil {
				t.Fatal("generated source has no EK0401")
			}
			caps := &lsproto.ResolvedClientCapabilities{}
			caps.Workspace.WorkspaceEdit.DocumentChanges = true
			caps.Workspace.WorkspaceEdit.ResourceOperations = []lsproto.ResourceOperationKind{lsproto.ResourceOperationKindCreate}
			ctx := lsproto.WithClientCapabilities(t.Context(), caps)
			response, err := service.ProvideCodeActions(ctx, &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: diag.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diag}}})
			if err != nil {
				t.Fatal(err)
			}
			var move *lsproto.CodeAction
			var titles []string
			if response.CommandOrCodeActionArray != nil {
				for _, a := range *response.CommandOrCodeActionArray {
					if a.CodeAction != nil {
						titles = append(titles, a.CodeAction.Title)
						if strings.Contains(a.CodeAction.Title, "to a .ts file") {
							move = a.CodeAction
						}
					}
				}
			}
			if capture {
				if move != nil {
					Gap(t, "FuzzNothrowMove", "nothrow-move:captured-cell:"+key, "captured cells must not move")
				}
				return
			}
			if move == nil && kind >= 6 {
				return
			} // A group move is optional; any offered move must retain the complete declaration group.
			if move == nil {
				Gap(t, "FuzzNothrowMove", "nothrow-move:missing:"+key, "missing safe .ts move: %v", titles)
			}
			if published && titles[0] != move.Title {
				Gap(t, "FuzzNothrowMove", "nothrow-move:published-order:"+key, "published export must prefer TS: %v", titles)
			}
			if move.Edit == nil || move.Edit.DocumentChanges == nil {
				t.Fatal("missing atomic creation")
			}
			next := maps.Clone(files)
			created := ""
			changes := map[string][]*lsproto.TextEdit{}
			for _, change := range *move.Edit.DocumentChanges {
				if change.CreateFile != nil {
					rel, err := filepath.Rel(r.Dir, change.CreateFile.Uri.FileName().AsString())
					if err != nil {
						t.Fatal(err)
					}
					if strings.HasPrefix(rel, "..") || next[rel] != "" {
						t.Fatalf("overwrites or escapes: %s", rel)
					}
					created = rel
					next[rel] = ""
				}
				if change.TextDocumentEdit != nil {
					rel, err := filepath.Rel(r.Dir, change.TextDocumentEdit.TextDocument.Uri.FileName().AsString())
					if err != nil {
						t.Fatal(err)
					}
					for _, e := range change.TextDocumentEdit.Edits {
						if e.TextEdit == nil {
							t.Fatal("unexpected edit kind")
						}
						changes[rel] = append(changes[rel], e.TextEdit)
					}
				}
			}
			for rel, edits := range changes {
				before, ok := next[rel]
				if !ok {
					t.Fatalf("edited uncreated file: %s", rel)
				}
				after, _, err := toolsApply(before, edits)
				if err != nil {
					t.Fatal(err)
				}
				next[rel] = after
			}
			if created == "" || !strings.Contains(next[created], declaration) || strings.Contains(next[created], "@throws") {
				t.Fatalf("changed declaration: %s", next[created])
			}
			if collision && next["f.ts"] != files["f.ts"] {
				t.Fatal("overwrote collision")
			}
			fixed := toolsCompile(t, w, "FuzzNothrowMove", next)
			defer fixed.Remove()
			if errors := toolsErrorCounts(fixed); len(errors) != 0 {
				Gap(t, "FuzzNothrowMove", "nothrow-move:new-error:"+key, "move left errors %v\n%s", errors, Archive(next))
			}
		})
	})
}

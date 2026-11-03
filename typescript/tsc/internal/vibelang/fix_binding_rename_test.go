package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Chapter 004, decided detail 245: two top-level patterns that bind one name
// in one home report TS2451 (TS2300 beside a parameter); the diagnostic
// offers to rename the later binding and its uses, and --fix applies it.
var bindingRenameTests = []struct{ name, source, want string }{
	{"explicit keys", `export function pick(a: unknown, b: unknown) {
  if (a is { id: let id }) return id
  if (b is { id: let id }) return id
  return 0
}
`, `export function pick(a: unknown, b: unknown) {
  if (a is { id: let id }) return id
  if (b is { id: let id2 }) return id2
  return 0
}
`},
	{"a shorthand binding keeps its key", `export function pick(a: unknown, b: unknown) {
  if (a is { let id }) return id
  if (b is { let id }) return id
  return 0
}
`, `export function pick(a: unknown, b: unknown) {
  if (a is { let id }) return id
  if (b is { id: let id2 }) return id2
  return 0
}
`},
	{"a shorthand after another field, with trivia", `export function pick(a: unknown, b: unknown) {
  if (a is { kind: "a", let id }) return id
  if (b is { kind: "b", /* the id */ let  id }) return id
  return 0
}
`, `export function pick(a: unknown, b: unknown) {
  if (a is { kind: "a", let id }) return id
  if (b is { kind: "b", /* the id */ id: let  id2 }) return id2
  return 0
}
`},
	{"later uses follow the later binding, earlier ones keep the first", `export function pick(a: unknown, b: unknown) {
  if (!(a is { id: let id })) return 0
  const first = id
  if (!(b is { id: let id })) return first
  const both = { first, id }
  return [both, () => id]
}
`, `export function pick(a: unknown, b: unknown) {
  if (!(a is { id: let id })) return 0
  const first = id
  if (!(b is { id: let id2 })) return first
  const both = { first, id: id2 }
  return [both, () => id2]
}
`},
	{"beside a parameter", `export function pick(a: unknown, id: number) {
  if (a is { id: let id }) return id
  return id
}
`, `export function pick(a: unknown, id: number) {
  if (a is { id: let id2 }) return id2
  return id
}
`},
	{"local fallback", `export function pick(a:unknown):unknown { const id=7; if (a is { id:let id }) return id; return id; }
`, `export function pick(a:unknown):unknown { const id=7; if (a is { id:let id2 }) return id2; return id; }
`},
	{"closure fallback", `export function pick(a:unknown,id:number):unknown { const fallback=():number=>id; if (a is { id:let id }) return id; return fallback(); }
`, `export function pick(a:unknown,id:number):unknown { const fallback=():number=>id; if (a is { id:let id2 }) return id2; return fallback(); }
`},
	{"later closure fallback", `export function pick(a:unknown,id:number):unknown { if (a is { id:let id }) return ()=>id; return ()=>id; }
`, `export function pick(a:unknown,id:number):unknown { if (a is { id:let id2 }) return ()=>id2; return ()=>id; }
`},
	{"else fallback", `export function pick(a:unknown,id:number):unknown { if (a is { id:let id }) return id; else return id; }
`, `export function pick(a:unknown,id:number):unknown { if (a is { id:let id2 }) return id2; else return id; }
`},
	{"conjunction and fallback", `export function pick(a:unknown,id:number):unknown { if (id===7 && a is { id:let id } && id===5) return id; return id; }
`, `export function pick(a:unknown,id:number):unknown { if (id===7 && a is { id:let id2 } && id2===5) return id2; return id; }
`},
	{"then shorthand and else shorthand", `export function pick(a:unknown,id:number):unknown { if (a is { id:let id }) return {id}; else return {id}; }
`, `export function pick(a:unknown,id:number):unknown { if (a is { id:let id2 }) return {id: id2}; else return {id}; }
`},
	{"the next free number", `export function pick(a: unknown, b: { id: number }) {
  const id2 = 2
  if (a is { id: let id }) return id
  if (b is { id: let id }) return id + id2
  return 0
}
`, `export function pick(a: unknown, b: { id: number }) {
  const id2 = 2
  if (a is { id: let id }) return id
  if (b is { id: let id3 }) return id3 + id2
  return 0
}
`},
	{"separate blocks need no rename", `export function pick(a: unknown, b: unknown) {
  { if (a is { id: let id }) return id }
  if (b is { id: let id }) return id
  return 0
}
`, ""},
}

func TestBindingRenameQuickFix(t *testing.T) {
	for _, test := range bindingRenameTests {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, test.source)
			var duplicate *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "" && (d.Code() == 2451 || d.Code() == 2300) {
					duplicate = d // the first report: TypeScript reports both declarations
					break
				}
			}
			if test.want == "" {
				if duplicate != nil {
					t.Fatalf("separate homes report %s", duplicate.String())
				}
				return
			}
			if duplicate == nil {
				t.Fatalf("no TS2451 or TS2300 in:\n%s", test.source)
			}
			// The report points at the quick fix (detail 245's compiler half).
			if !strings.Contains(notesOf(duplicate), "the quick fix renames the later binding") {
				t.Fatalf("TS%d at the first report lacks the rename note: %q", duplicate.Code(), notesOf(duplicate))
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, duplicate)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			var chosen *lsproto.CodeAction
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Rename the later binding ") {
						chosen = action.CodeAction
					}
				}
			}
			if chosen == nil || chosen.Edit == nil || chosen.Edit.Changes == nil {
				t.Fatalf("no rename quick fix at TS%d", duplicate.Code())
			}
			changes := *chosen.Edit.Changes
			if len(changes) != 1 {
				t.Fatalf("the fix edits other documents: %v", changes)
			}
			got := applyEditorEdits(t, file, converters, changes[lsconv.FileNameToDocumentURI(file.FileName())])
			if got != test.want {
				t.Fatalf("edited source differs:\ngot:\n%s\nwant:\n%s", got, test.want)
			}
			if errors := errorsOf(t, got); len(errors) != 0 {
				t.Fatalf("the fixed source reports %v", errors)
			}
		})
	}
}

// --fix applies the rename in both modes, reports it as a rewrite kind, and a
// second run changes nothing. A third pattern of the name is renamed in the
// same round, with the reads after it.
func TestBindingRenameFix(t *testing.T) {
	tests := append(bindingRenameTests, struct{ name, source, want string }{"three patterns", `export function pick(a: unknown, b: unknown, c: unknown) {
  if (a is { id: let id }) return id
  if (b is { id: let id }) return id
  if (c is { let id }) return id
  return 0
}
`, `export function pick(a: unknown, b: unknown, c: unknown) {
  if (a is { id: let id }) return id
  if (b is { id: let id2 }) return id2
  if (c is { id: let id3 }) return id3
  return 0
}
`})
	for _, options := range []FixOptions{{}, {MigrationOnly: true}} {
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				p, file, _, _ := editorProgram(t, test.source)
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), options)
				if test.want == "" {
					if len(result.Files) != 0 || len(result.Refused) != 0 {
						t.Fatalf("separate homes: --fix changed the project: %+v", result)
					}
					return
				}
				if len(result.Refused) != 0 || len(result.Files) != 1 {
					t.Fatalf("--fix: %+v", result)
				}
				fixed := result.Files[file.FileName()]
				if fixed.Text != test.want {
					t.Fatalf("--fix writes\n%s\nwant\n%s", fixed.Text, test.want)
				}
				if fixed.Rewrites[isBindingRenameLabel] == 0 || len(fixed.Counts) != 0 {
					t.Fatalf("the renames count as %v, %v", fixed.Rewrites, fixed.Counts)
				}
				var report strings.Builder
				result.Report(&report, func(name tspath.RootedFilePath) string { return "main.vibe" })
				if !strings.Contains(report.String(), isBindingRenameLabel+" ×") {
					t.Fatalf("the report does not name the renames: %s", report.String())
				}
				if errors := errorsOf(t, fixed.Text); len(errors) != 0 {
					t.Fatalf("fixed source reports %v", errors)
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), options)
				if len(again.Files) != 0 || len(again.Refused) != 0 {
					t.Fatalf("second fix changed the project: %+v", again)
				}
			})
		}
	}
}

// The parser deliberately leaves structural is holders unmarked and anchors
// their inner tests on the is token. Keep a direct metadata regression so a
// parser change cannot silently broaden migration ownership back to the home.
func TestBindingRenameLegacyScopeMetadata(t *testing.T) {
	for _, tc := range []struct {
		name, condition string
		positive        bool
	}{
		{"direct", "a is {id:let id}", true},
		{"conjunction", "true && (a is {id:let id}) && id!==undefined", true},
		{"negation", "!(a is {id:let id})", false},
		{"disjunction", "false || (a is {id:let id})", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, "export function f(a:unknown,id:number):unknown { if ("+tc.condition+") return id; return id; }")
			found := false
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsVariableDeclaration(node) && node.Flags&ast.NodeFlagsVibeLangIsBinding != 0 {
					found = true
					condition, then := legacyBindingRenameScope(node.Parent.Parent.Parent, node.Name())
					if (condition != nil) != tc.positive || (then != nil) != tc.positive {
						t.Fatalf("legacy positive scope=%t, want%t; binding range=%v, home kind=%v", condition != nil, tc.positive, node.Name().Loc, node.Parent.Parent.Parent.Kind)
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !found {
				t.Fatal("parser did not retain an is binding declaration")
			}
		})
	}
}
// VIP-7 rename only original binding references, preserving parameter/local/else/closure fallback; rule: docs/design/vips/0007-match.md#c4631b5aaa90d198
// VIP-7 rename only original binding references, preserving parameter/local/else/closure fallback; rule: docs/design/vips/0007-match.md#b427fe2618b9c094
// VIP-7 rename only original binding references, preserving parameter/local/else/closure fallback; rule: docs/design/vips/0007-match.md#a5f2cfddf27c2cc0
// VIP-7 rename only original binding references, preserving parameter/local/else/closure fallback; rule: docs/design/vips/0007-match.md#fc189447d5899233
// VIP-7 rename only original binding references, preserving parameter/local/else/closure fallback; rule: docs/design/vips/0007-match.md#7e36e007232676f1
// VIP-7 rename only original binding references, preserving parameter/local/else/closure fallback; rule: docs/design/vips/0007-match.md#c786f8ffb7193c83

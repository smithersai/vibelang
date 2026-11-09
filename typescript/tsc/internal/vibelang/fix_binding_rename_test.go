package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
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
	{"the next free number", `export function pick(a: unknown, b: { readonly id: number }) {
  const id2 = 2
  if (a is { id: let id }) return id
  if (b is { id: let id }) return id + id2
  return 0
}
`, `export function pick(a: unknown, b: { readonly id: number }) {
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

// VIP-16 variant rename follows resolved bindings without changing sibling constructors; rule: docs/design/vips/0016-data-declarations.md#39d812e34a5dd91e

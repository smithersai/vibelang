package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestForeignPredicateFixScopes(t *testing.T) {
	helper := "export function isResolved(x: unknown): x is string { return typeof x === 'string' }"
	for _, tc := range []struct{ name, body, want, title string }{
		{"const", "const x: unknown = input; if (isResolved(x)) { const s: string = x; return { x } }; return { x }", "return { x: resolved }", "preserving narrowing"},
		{"nested shadow", "if (isResolved(x)) { const resolved = 1; { const x = 2; void x }; const s: string = x; return s }; return ''", "const s: string = resolved_", "preserving narrowing"},
		{"const destructuring", "const { x } = { x: input }; if (isResolved(x)) { const s: string = x; return s }; return ''", "const s: string = resolved", "preserving narrowing"},
		{"parameter destructuring", "if (isResolved(x)) { const s: string = x; return s }; return ''", "const s: string = resolved", "preserving narrowing"},
		{"plain predicate name", "if (isResolved(x)) return x; return ''", "const narrowed = try", "preserving narrowing"},
		{"local let", "let x: unknown = input; if (isResolved(x)) return x; return ''", "try: () => isResolved(x),", "unreassigned const or parameter"},
		{"captured write", "const change = () => { x = undefined }; if (isResolved(x)) { change(); return x }; return ''", "try: () => isResolved(x),", "unreassigned const or parameter"},
		{"destructuring write", "if (isResolved(x)) { ({ x } = { x: undefined }); return x }; return ''", "try: () => isResolved(x),", "unreassigned const or parameter"},
		{"unbraced outer", "if (input) if (isResolved(x)) return x; return ''", "if (input) {", "preserving narrowing"},
		{"hoisted function", "const saved = keep(); if (!isResolved(x)) return saved; function keep(): unknown { return x }; const s: string = x; return s", "function keep(): unknown { return x }", "preserving narrowing"},
		{"negative else", "if (!isResolved(x)) { return '' } else { const s: string = x; return s }", "const s: string = resolved", "preserving narrowing"},
		{"generic unconstrained", "if (isResolved(x)) return x; return undefined", "try: () => isResolved(x),", "includes undefined"},
		{"generic nullable constraint", "if (isResolved(x)) return x; return undefined", "try: () => isResolved(x),", "includes undefined"},
		{"generic union", "if (isResolved(x)) return x; return undefined", "try: () => isResolved(x),", "includes undefined"},
		{"generic constrained", "if (isResolved(x)) return x; return undefined", "const resolved = try", "preserving narrowing"},
		{"generic null constraint", "if (isResolved(x)) return x; return undefined", "const resolved = try", "preserving narrowing"},
		{"generic intersection", "if (isResolved(x)) return x; return undefined", "const resolved = try", "preserving narrowing"},
		{"ambiguous alias", "if (isResolved(x)) return x; return ''", "try: () => isResolved(x),", "includes undefined"},
		{"or first operand", "if (!isResolved(x) || x.length === 0) return ''; const s: string = x; return s", "; if (resolved === undefined || resolved.length === 0) return ''; const s: string = resolved", "preserving narrowing"},
		{"or first operand else", "if (!isResolved(x) || x.length === 0) { return '' } else { return x }", "if (resolved === undefined || resolved.length === 0) { return '' } else { return resolved }", "preserving narrowing"},
		{"or later operand", "if (input === 1 || !isResolved(x)) return ''; const s: string = x; return s", "if (input === 1) return '';\nconst resolved = try Effect.orDie(Effect.try({ try: () => isResolved(x) ? x : undefined, catch: (e) => e }))\nif (resolved === undefined) return ''; const s: string = resolved", "preserving narrowing"},
		{"or middle operand", "if (input === 1 || !isResolved(x) || x.length === 0) return ''; return x", "if (input === 1) return '';\nconst resolved = try Effect.orDie(Effect.try({ try: () => isResolved(x) ? x : undefined, catch: (e) => e }))\nif (resolved === undefined || resolved.length === 0) return ''; return resolved", "preserving narrowing"},
		{"and first operand else", "if (isResolved(x) && x.length > 0) { return x } else { return '' }", "if (resolved !== undefined && resolved.length > 0) { return resolved } else { return '' }", "preserving narrowing"},
		{"and later operand", "if (input === 1 && isResolved(x) && x.length > 0) return x; return ''", "if (input === 1) {\n  const resolved = try Effect.orDie(Effect.try({ try: () => isResolved(x) ? x : undefined, catch: (e) => e }))\n  if (resolved !== undefined && resolved.length > 0) return resolved;\n} return ''", "preserving narrowing"},
		{"or later operand else", "if (input === 1 || !isResolved(x)) { return '' } else { return x }", "try: () => isResolved(x),", "an else"},
		{"or later operand stays", "if (input === 1 || !isResolved(x)) { input = 2 }; return ''", "try: () => isResolved(x),", "does not exit"},
		{"and later operand else", "if (input === 1 && isResolved(x)) { return x } else { return '' }", "try: () => isResolved(x),", "an else"},
		{"mixed operators", "if (input === 1 || input === 2 && !isResolved(x)) return ''; return ''", "try: () => isResolved(x),", "preserving failures"},
		{"parenthesized chain", "if ((input === 1 || !isResolved(x))) return ''; return ''", "try: () => isResolved(x),", "preserving failures"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lib := helper
			if tc.name == "ambiguous alias" {
				lib = "type Maybe = string | undefined; export function isResolved(x: unknown): x is Maybe { return true }"
			}
			typeParameters := ""
			if strings.HasPrefix(tc.name, "generic ") {
				lib = "export function isResolved<T>(x: T | undefined): x is T { return x !== undefined }"
				typeParameters = "<T>"
			}
			files := neverFixFiles(lib, "helper.ts")
			params := "x: unknown, input: unknown"
			if tc.name == "const" || tc.name == "local let" || tc.name == "const destructuring" {
				params = "input: unknown"
			}
			if tc.name == "parameter destructuring" {
				params = "{ x }: { x: unknown }, input: unknown"
			}
			if typeParameters != "" {
				params = "x: T | undefined, input: unknown"
				switch tc.name {
				case "generic constrained":
					typeParameters = "<T extends string>"
				case "generic nullable constraint":
					typeParameters = "<T extends string | undefined>"
				case "generic null constraint":
					typeParameters = "<T extends string | null>"
				case "generic union":
					params = "x: T | number | undefined, input: unknown"
				case "generic intersection":
					params = "x: (T & {}) | undefined, input: unknown"
				}
			}
			files[neverFixRoot+"main.vibe"] = "import { isResolved } from './helper.js'\nexport effect function main" + typeParameters + "(" + params + ") { " + tc.body + " }\n"
			if tc.name == "plain predicate name" {
				for name, source := range files {
					files[name] = strings.ReplaceAll(source, "isResolved", "accepts")
				}
			}
			p := computedKeyProgram(t, files)
			file := p.GetSourceFile(neverFixRoot + "main.vibe")
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			var found bool
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsCallExpression(n) && (nodeText(file, n.Expression()) == "isResolved" || nodeText(file, n.Expression()) == "accepts") {
					plan := planForeignCall(c, file, n)
					if plan == nil || !strings.Contains(applyEdits(file.Text(), plan.edits), tc.want) {
						t.Fatalf("missing %q in rewrite: %+v", tc.want, plan)
					}
					if !strings.Contains(plan.description, tc.title) {
						t.Fatalf("title %q lacks %q", plan.description, tc.title)
					}
					found = true
				}
				n.ForEachChild(visit)
				return false
			}
			file.AsNode().ForEachChild(visit)
			if !found {
				t.Fatal("missing predicate")
			}
		})
	}
}

package vibelangmapper

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestProjectionMemberTypeSafety(t *testing.T) {
	for _, tc := range []struct{ name, source, keep string }{
		{"local-effect-union", `type Effect = "burn" | "freeze"; function pick(): Effect { return "burn" }`, `function pick(): Effect { return "burn" }`},
		{"computed-service-key", `const k = "key"; service Users { static readonly [k] = "app/Users"; find(id: string): string! }`, `app/src/main#Users`},
		{"computed-service-key-owned-call", `const k = "key"; service Users { static readonly [k] = "app/Users"; find(id: string): string! }; function main() { return Users.pipe() }`, `app/src/main#Users`},
		{"computed-service-implementation", `import { Effect } from "effect"; service Users { find(): Effect<string> }; Layer.succeed(Users, { [Symbol.iterator](): string { return "x" }, find(): Effect<string> { return () => "x" } })`, `[Symbol.iterator]`},
		{"computed-success-member", `function f(): Effect<{ [Symbol.iterator]: number }> { return () => 1 }`, `[Symbol.iterator]: number`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if p := recover(); p != nil {
					t.Fatalf("projection panicked: %v", p)
				}
			}()
			for name, project := range map[string]func(string, FileContext) Projection{"checking": Project, "executable": Executable} {
				t.Run(name, func(t *testing.T) {
					defer func() {
						if p := recover(); p != nil {
							t.Fatalf("projection panicked: %v", p)
						}
					}()
					p := project(tc.source, testContext)
					if !strings.Contains(p.Text, tc.keep) {
						t.Fatalf("lost %q:\n%s", tc.keep, p.Text)
					}
					assertValidMap(t, p, tc.source)
				})
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName}, tc.source, core.ScriptKindTS)
			FormDiagnostics(file)
		})
	}
}

func TestEffectReturnTypeShadowing(t *testing.T) {
	for _, source := range []string{
		`type Effect = "burn"; function pick(): Effect { return "burn" }`,
		`type Effect = number; function pick(): Effect { return 1 }`,
		`type Effect = { value: number }; function pick(): Effect { return { value: 1 } }`,
		`interface Effect { value: number }; function pick(): Effect { return { value: 1 } }`,
		`type Effect<T> = T; function pick(): Effect<number> { return 1 }`,
		`interface Effect<T> { value: T }; function pick(): Effect<number> { return { value: 1 } }`,
		`function outer(): void { type Effect = number; function pick(): Effect { return 1 } }`,
		`function pick<Effect>(value: Effect): Effect { return value }`,
		`type Effect = number; const pick = (): Effect => 1`,
		`type Effect = number; class C { pick(): Effect { return 1 } }`,
		`type Effect = number; const c = { pick(): Effect { return 1 } }`,
	} {
		t.Run(source, func(t *testing.T) {
			for _, project := range []func(string, FileContext) Projection{Project, Executable} {
				p := project(source, testContext)
				body := p.Text[strings.Index(p.Text, ";")+1:]
				if strings.Contains(body, "return $gen(") || strings.Contains(body, "yield*") {
					t.Fatalf("local Effect type changed a plain body:\n%s", p.Text)
				}
				assertValidMap(t, p, source)
			}
		})
	}
}

func TestFactorySuccessTypeNodeKinds(t *testing.T) {
	for _, shape := range []string{
		`{ [Symbol.iterator]: number }`,
		`{ ["value"]: number }`,
		`{ 0: number }`,
		`{ "name": string }`,
		`{ [Symbol.iterator]?: number }`,
		`{ (): number }`,
	} {
		for _, declaration := range []string{"", "type Shape = " + shape + "; ", "interface Shape " + shape + "; "} {
			success := shape
			if declaration != "" {
				success = "Shape"
			}
			source := declaration + "function f(): Effect<" + success + "> { return () => 1 }"
			t.Run(source, func(t *testing.T) {
				for _, project := range []func(string, FileContext) Projection{Project, Executable} {
					p := project(source, testContext)
					assertValidMap(t, p, source)
					assertParses(t, p.Text)
				}
			})
		}
	}
}

func TestEffectTypeMeanings(t *testing.T) {
	for _, tc := range []struct {
		source string
		effect bool
	}{
		{`type Effect = number; function pick(): Effect { return 1 }`, false},
		{`type Made = Effect.Effect<number>; function pick(): Made { return () => 1 }`, false},
		{`type Whole<A, E> = Effect.Effect<A, E>; function pick(): Whole<number, never> { return () => 1 }`, false},
		{`interface Effect<T> { value: T }; function pick(): Effect<number> { return { value: 1 } }`, false},
		{`function pick<Effect>(x: Effect): Effect { return x }`, false},
		{`type Effect = number; function outer(): void { class Effect {}; function pick(): Effect { return new Effect() } }`, false},
		{`type Effect = number; function pick(): Effect.Effect<number> { return () => 1 }`, true},
		{`import { Effect } from "effect"; function pick(): Effect.Effect<number> { return () => 1 }`, true},
		{`import type { Effect } from "./foreign.js"; function pick(): Effect { return 1 }`, false},
		{`type Effect = Effect.Effect<number>; function pick(): Effect { return () => 1 }`, true},
	} {
		t.Run(tc.source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName}, tc.source, core.ScriptKindTS)
			r := newFormResolver(file).(*Resolver)
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsFunctionDeclaration(n) && n.Name().Text() == "pick" {
					if got := r.isEffectTypeNode(n.Type(), 0); got != tc.effect {
						t.Errorf("resolver Effect = %v; want %v", got, tc.effect)
					}
					if got := isWrittenEffectReference(n.Type()); got != tc.effect {
						t.Errorf("written Effect = %v; want %v", got, tc.effect)
					}
				}
				return n.ForEachChild(visit)
			}
			visit(file.AsNode())
		})
	}
}

func TestEffectSuccessRejectsNonReferences(t *testing.T) {
	for _, shape := range []string{`"burn" | "freeze"`, `"burn"`, "number", "{ value: number }", "(number)", "readonly number[]", "() => number"} {
		t.Run(shape, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName}, "type Shape = "+shape, core.ScriptKindTS)
			r := newFormResolver(file).(*Resolver)
			if got := r.effectSuccess(file.Statements.Nodes[0].Type(), 0); got != nil {
				t.Fatalf("unexpected success type: %v", got.Kind)
			}
		})
	}
}

func TestWrittenEffectNamespaceImportCompatibility(t *testing.T) {
	for _, imported := range []string{`import { Effect } from "effect";`, `import * as Effect from "effect/Effect";`} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName}, imported+" function pick(): Effect<number> { return () => 1 }", core.ScriptKindTS)
		if got := contractOf(file.Statements.Nodes[1].Type()); got != contractEffect {
			t.Fatalf("namespace import hid the transitional type alias: %v", got)
		}
	}
}

func TestLocalEffectScopeSafety(t *testing.T) {
	for _, source := range []string{
		`namespace Effect { export type Effect<A> = () => A }; function pick(): Effect.Effect<number> { return () => 1 }`,
		`declare const key: number; switch (key) { case 0: type Effect = number; break; case 1: function pick(): Effect { return 1 } }`,
		`declare const key: number; switch (key) { case 0: function pick(): Effect { return 1 }; break; default: type Effect = number; }`,
	} {
		t.Run(source, func(t *testing.T) {
			for _, project := range []func(string, FileContext) Projection{Project, Executable} {
				p := project(source, testContext)
				if strings.Contains(p.Text, "return $gen(") {
					t.Fatalf("local Effect scope changed a plain body:\n%s", p.Text)
				}
				assertValidMap(t, p, source)
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName}, source, core.ScriptKindTS)
			r := newFormResolver(file).(*Resolver)
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsFunctionDeclaration(n) && n.Name().Text() == "pick" {
					if r.isEffectTypeNode(n.Type(), 0) || isWrittenEffectReference(n.Type()) {
						t.Errorf("local Effect type was recognized as the prelude")
					}
				}
				return n.ForEachChild(visit)
			}
			visit(file.AsNode())
			FormDiagnostics(file)
		})
	}
}

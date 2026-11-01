package vibelangfmt_test

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

func returnTypeGroups(source string) int {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.ts", PathKey: "/test.ts"}, source, core.ScriptKindTS)
	groups := 0
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindParenthesizedType {
			groups++
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return groups
}

func TestFormatWrittenReturnTypeParentheses(t *testing.T) {
	sources := []string{
		"module publicApi { export const make = (): (() => string) => () => 'ok' }\n",
		"export const make = (): (() => string) => (): infer _ => 'ok'\n",
		"export const make = (): ((() => (() => string))) => () => () => 'ok'\n",
		"export const make = (): (<A>(a: A) => A) => <A>(a: A): A => a\n",
		"export function make(): (() => string) { return () => 'ok' }\n",
		"export const make = (): (() => string) | undefined => undefined\n",
		"export const make = (): (() => string)[] => []\n",
		"export const make = (): (new () => object) => class {}\n",
		"interface Factory { make(): (() => string); (n: number): (<A>(a: A) => A) }\n",
		"export class Factory { make(): (() => string) { return () => 'ok' } }\n",
		"export const make = (): (() => string /* public */) => (): string => 'ok'\n",
		"export const make = (): (/** factory */ () => (/** nested */ () => string)) => (): (() => string) => (): string => 'ok'\n",
		"export const make = (): ( /* public */ () => ( /* nested */ () => string)) => () => () => 'ok'\n",
	}
	for _, source := range sources {
		for _, host := range []string{"language-server", "dprint", "identity"} {
			t.Run(host+"/"+strings.Split(source, "\n")[0], func(t *testing.T) {
				formatter := vibelangfmt.TypeScriptFormatter(foldkitLSFormatter)
				if host == "dprint" {
					formatter = foldkitDprintFormatter(t)
				}
				if host == "identity" {
					formatter = func(s string) (string, error) { return s, nil }
				}
				once, err := vibelangfmt.Format("return.vibe", source, formatter)
				if err != nil {
					t.Fatal(err)
				}
				if got, want := returnTypeGroups(once), returnTypeGroups(source); got != want {
					t.Fatalf("written return-type groups: got %d, want %d\n%s", got, want, once)
				}
				twice, err := vibelangfmt.Format("return.vibe", once, formatter)
				if err != nil || twice != once {
					t.Fatalf("unstable: %v\n%s\n%s", err, once, twice)
				}
			})
		}
	}
}

func TestFormatFoldkitPublicReturnCorpus(t *testing.T) {
	source, err := os.ReadFile("testdata/foldkit-ui-public-return-parentheses.vibe")
	if err != nil {
		t.Fatal(err)
	}
	once, err := vibelangfmt.Format("foldkit-ui.vibe", string(source), foldkitDprintFormatter(t))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(once, ": (() => string) =>") {
		t.Fatalf("published return parentheses lost:\n%s", once)
	}
}

// Declaration emit retains comments enclosed by written type parentheses.
// Keep the nesting of each comment, not just the total number of groups.
func TestFormatReturnTypeCommentGroups(t *testing.T) {
	sources := []string{
		"export function make(): ((/* public */ (() => string) | undefined /* result */)) { return undefined }\n",
		"export function make(): /* outside */ ((/* public */ (() => string) | undefined /* result */)) /* after */ { return undefined }\n",
		"export function make(): (/* outer */ (/* inner */ (() => string) | undefined /* last */) /* result */) { return undefined }\n",
		"export function make(): (/* outer */ (() => (/* inner */ string /* last */)) /* result */) { return () => 'ok' }\n",
		"export function make(): (/* outer */ (/* inner */ (() => string)))[] { return [] }\n",
		"export function make(): (/* outer */ <A>(a: A) => (/* inner */ A)) { return a => a }\n",
		"export function make(): (// public\n(() => string) | undefined // result\n) { return undefined }\n",
		"export function make(): (/* outer */ (// public\n(() => string) | undefined // result\n)) { return undefined }\n",
	}
	markers := []string{"/* public */", "/* result */", "/* outside */", "/* after */", "/* outer */", "/* inner */", "/* last */", "// public", "// result"}
	for _, source := range sources {
		for _, host := range []string{"language-server", "dprint", "identity"} {
			for _, module := range []bool{false, true} {
				input := source
				if module {
					input = "module publicApi {\n" + source + "}\n"
				}
				t.Run(host+"/"+input, func(t *testing.T) {
					formatter := vibelangfmt.TypeScriptFormatter(foldkitLSFormatter)
					if host == "dprint" {
						formatter = foldkitDprintFormatter(t)
					}
					if host == "identity" {
						formatter = func(s string) (string, error) { return s, nil }
					}
					once, err := vibelangfmt.Format("comments.vibe", input, formatter)
					if err != nil {
						t.Fatal(err)
					}
					for _, marker := range markers {
						if !strings.Contains(input, marker) {
							continue
						}
						if strings.Count(once, marker) != 1 {
							t.Fatalf("comment %q changed:\n%s", marker, once)
						}
						if got, want := typeCommentGroups(once, marker), typeCommentGroups(input, marker); got != want {
							t.Fatalf("comment %q has %d enclosing type groups, want %d\n%s", marker, got, want, once)
						}
					}
					twice, err := vibelangfmt.Format("comments.vibe", once, formatter)
					if err != nil || once != twice {
						t.Fatalf("unstable: %v\n%s\n%s", err, once, twice)
					}
				})
			}
		}
	}
}

func typeCommentGroups(source, marker string) int {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/comments.ts", PathKey: "/comments.ts"}, source, core.ScriptKindTS)
	pos, groups := strings.Index(source, marker), 0
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindParenthesizedType && scanner.SkipTrivia(source, node.Pos()) < pos && pos < node.End() {
			groups++
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return groups
}

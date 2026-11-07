package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestProducerMethodAfterFieldProjection(t *testing.T) {
	for _, prefix := range []string{"", "public ", "static ", "private "} {
		for _, trivia := range []string{"\n", "\r\n", "\n// next member\n", "\n/* next member */\n"} {
			source := "class Feed { marker=false" + trivia + prefix + "effect *values() { yield this.marker } }"
			t.Run(prefix+trivia, func(t *testing.T) {
				for _, mode := range []string{"checking", "lint", "execution"} {
					t.Run(mode, func(t *testing.T) {
						ctx := testContext
						ctx.Lint = mode == "lint"
						var got Projection
						if mode == "execution" {
							got = Executable(source, ctx)
						} else {
							got = Project(source, ctx)
						}
						if len(got.Diagnostics) != 0 {
							t.Fatalf("diagnostics: %v\n%s", got.Diagnostics, got.Text)
						}
						assertParses(t, got.Text)
						assertValidMap(t, got, source)
						file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/field.ts")}, got.Text, core.ScriptKindTS)
						var field, method bool
						var visit func(*ast.Node) bool
						visit = func(n *ast.Node) bool {
							if n.Kind == ast.KindPropertyDeclaration && n.Name().Text() == "marker" {
								field = n.Initializer() != nil && n.Initializer().Kind == ast.KindFalseKeyword
							}
							if n.Kind == ast.KindMethodDeclaration && n.Name().Text() == "values" {
								method = true
							}
							return n.ForEachChild(visit)
						}
						visit(file.AsNode())
						if !field || !method || !strings.Contains(got.Text, "return $produce(") {
							t.Fatalf("field=%t method=%t:\n%s", field, method, got.Text)
						}
					})
				}
			})
		}
	}
}

func TestProducerMethodAfterFieldRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	source := "import * as Eff from \"effect/Effect\"; import * as Str from \"effect/Stream\"; class Feed { marker=false\n effect *values() { yield this.marker } }; const feed=new Feed();"
	js, _, diagnostics := Emit(source, testContext)
	if len(diagnostics) != 0 {
		t.Fatalf("diagnostics: %v\n%s", diagnostics, js)
	}
	cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nimport * as TestEffect from \"effect/Effect\"; import * as TestStream from \"effect/Stream\"; const stream=feed.values(); feed.marker=true; console.log(JSON.stringify(await TestEffect.runPromise(TestStream.runCollect(stream))));")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("runtime: %v\n%s\n%s", err, output, js)
	}
	if strings.TrimSpace(string(output)) != "[true]" {
		t.Fatalf("receiver result: %s", output)
	}
}

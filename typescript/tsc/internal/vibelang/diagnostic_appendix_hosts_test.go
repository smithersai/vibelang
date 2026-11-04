package vibelang

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestAppendixEditorHostExamples(t *testing.T) {
	appendix, err := os.ReadFile("../../../../docs/design/src/900-appendices.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, source, want string }{
		{"yield-star", "import {Effect} from 'effect'; export function* g() { yield Effect.succeed(1) }", "import {Effect} from 'effect'; export function* g() { yield* Effect.succeed(1) }"},
		{"yield-return", "import {Effect} from 'effect'; export function* g() { yield* Effect.fail('x') }", "import {Effect} from 'effect'; export function* g() { return yield* Effect.fail('x') }"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pattern := "(?m)^\\| interim `(EK[0-9]+)` \\|[^\\n]*\\[editor example: " + regexp.QuoteMeta(tc.name) + "\\]"
			row := regexp.MustCompile(pattern).FindSubmatch(appendix)
			if len(row) != 2 {
				t.Fatalf("missing Appendix row for %s", tc.name)
			}
			code, _ := strconv.Atoi(string(row[1][2:]))
			program, original, service, converters := editorProgram(t, tc.source)
			filename := filepath.Join(filepath.Dir(original.FileName().AsString()), "main.ts")
			if err := os.WriteFile(filename, []byte(tc.source), 0600); err != nil {
				t.Fatal(err)
			}
			file := parser.ParseSourceFile(astSourceOptions(filename), tc.source, core.ScriptKindTS)
			ast.SetParentInChildren(file.AsNode())
			var yieldNode *ast.Node
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsYieldExpression(n) {
					yieldNode = n
					return true
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if yieldNode == nil {
				t.Fatal("fixture has no yield")
			}
			span := scanner.GetErrorRangeForNode(file, yieldNode)
			actions, err := yieldStarFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: span, ErrorCode: int32(code), Program: program, LS: service})
			if err != nil || len(actions) != 1 {
				t.Fatalf("EK%d repair: %+v %v", code, actions, err)
			}
			got := applyEditorEdits(t, file, converters, actions[0].Changes)
			if got != tc.want {
				t.Fatalf("got %s; want %s", got, tc.want)
			}
		})
	}
}

// Keep the real .ts filename: this provider intentionally declines .vibe files.
func astSourceOptions(name string) ast.SourceFileParseOptions {
	return ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(filepath.ToSlash(name))}
}

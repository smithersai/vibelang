package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// LSP position-based requests ascend the parsed tree. Every parent on a
// written extractor matcher's path must contain the child's source range.
func TestExtractorMatcherAncestorSpans(t *testing.T) {
	for matcher, kind := range map[string]ast.Kind{
		"Matcher":            ast.KindIdentifier,
		"Matchers.pick":      ast.KindPropertyAccessExpression,
		"Matchers.deep.pick": ast.KindPropertyAccessExpression,
		"Matchers[\"pick\"]": ast.KindElementAccessExpression,
		"/a/g":               ast.KindRegularExpressionLiteral,
	} {
		for _, gap := range []string{"", " ", " /* matcher */ "} {
			pattern := matcher + gap + "(let item)"
			for key, body := range map[string]string{
				"match": "return match (value) { when " + pattern + ": item; default: undefined; }",
				"if":    "if (value is " + pattern + ") { return item; }",
				"while": "while (value is " + pattern + ") { return item; }",
				"is":    "return value is " + pattern,
			} {
				t.Run(fmt.Sprintf("%s/%s/%q", key, matcher, gap), func(t *testing.T) {
					source := "function read(value: unknown) { " + body + " }"
					file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
					found := 0
					var visit func(*ast.Node) bool
					visit = func(node *ast.Node) bool {
						// Generated indexing nodes can share the matcher's source anchor.
						if node.Kind == kind && node.Flags&ast.NodeFlagsReparsed == 0 && node.Pos() >= 0 && node.End() <= len(source) &&
							strings.TrimSpace(source[node.Pos():node.End()]) == matcher {
							found++
							for child := node; child.Parent != nil; child = child.Parent {
								parent := child.Parent
								if parent.Pos() > child.Pos() || parent.End() < child.End() {
									t.Errorf("%s [%d,%d) outside %s [%d,%d): %s", child.KindString(), child.Pos(), child.End(), parent.KindString(), parent.Pos(), parent.End(), source)
								}
							}
						}
						return node.ForEachChild(visit)
					}
					file.AsNode().ForEachChild(visit)
					if found == 0 {
						t.Fatalf("written matcher %q disappeared: %s", matcher, source)
					}
				})
			}
		}
	}
}

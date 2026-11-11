package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestRetryPolicyComputedOptionNames(t *testing.T) {
	for _, options := range []string{
		`{ retryPolicy: { ["maxAttempts"]: 3 } }`,
		`{ retryPolicy: { initialMs: 10, [key]: 40, maxAttempts: 2 } }`,
		`{ [key]: 1, retryPolicy: { maxAttempts: 2 } }`,
		`{ ["other"]: 1, retryPolicy: { expirationMs: 20 } }`,
		`{ ["retryPolicy"]: { ["maxAttempts"]: 2 } }`,
		`{ retryPolicy: { ...bounds } }`,
	} {
		t.Run(options, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, "const options = "+options, core.ScriptKindTS)
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsVariableDeclaration(node) {
					// These policies need no diagnostic or checker. In
					// particular, an unrelated computed option is skipped.
					checkRetryPolicy(nil, node.Initializer())
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
		})
	}
}

func TestRetryPolicyIncompleteComputedNameDiagnostics(t *testing.T) {
	for _, fragment := range []string{"[", "[\"", "[\"maxAttempts\"", "[key", "[key]:"} {
		t.Run(fragment, func(t *testing.T) {
			source := "const key = \"maxMs\"\ntask Fetch {\n static readonly retryPolicy = { " + fragment + "\n }\n effect call(id: string): number!string { return id.length }\n}"
			config := strings.TrimSuffix(editorTsconfig, "}") + `,"vibe":{"experimental":["builtins"]}}`
			program, file, _, _ := editorProgramConfig(t, source, editorPackageJSON, editorPackages, config)
			if len(program.GetSyntacticDiagnostics(t.Context(), file)) == 0 {
				t.Fatal("an unfinished computed property must retain its syntax diagnostic")
			}
			// The language server requests semantic diagnostics even while
			// a computed property is incomplete.
			program.GetSemanticDiagnostics(t.Context(), file)
		})
	}
}

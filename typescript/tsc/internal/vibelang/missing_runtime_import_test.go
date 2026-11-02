package vibelang

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Error recovery can leave an import's module specifier as an expression.
// Semantic/editor diagnostics still run after syntax errors; a missing runtime
// must not turn their diagnostic request into a Node.Text panic.
func TestMissingRuntimeMalformedImport(t *testing.T) {
	for _, module := range []string{"vibelang-runtime", "vibelang-runtime/experimental", "another-package"} {
		for _, newline := range []string{"\n", "\r\n"} {
			t.Run(module+":"+strings.ReplaceAll(newline, "\n", "LF"), func(t *testing.T) {
				source := "import { Data } from \"effect\"\nimport { Control, handle, resumeWithion nee \"" + module + "\"\nclass Busy extends Data.TaggedError(\"Busy\")<{}> {}\n"
				source = strings.ReplaceAll(source, "\n", newline)
				_, file, _, _ := editorProgramWith(t, source, map[string]string{"effect": "packages/runtime/node_modules/effect"})
				fs := bundled.WrapFS(missingRuntimeTestFS{osvfs.FS()})
				config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
				if len(errors) != 0 || len(config.Errors) != 0 {
					t.Fatalf("config: %v %v", errors, config.Errors)
				}
				program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
				file = program.GetSourceFile(file.FileName())
				badSpecifier := false
				for _, statement := range file.Statements.Nodes {
					if ast.IsImportDeclaration(statement) {
						spec := statement.AsImportDeclaration().ModuleSpecifier
						badSpecifier = badSpecifier || spec != nil && !ast.IsStringLiteral(spec)
					}
				}
				if !badSpecifier {
					t.Fatal("witness has no recovered non-string import")
				}
				before := program.GetSyntacticDiagnostics(t.Context(), file)
				if len(before) == 0 {
					t.Fatal("witness has no syntax diagnostic")
				}
				for repeat := 0; repeat < 2; repeat++ {
					program.GetSemanticDiagnostics(t.Context(), file)
					after := program.GetSyntacticDiagnostics(t.Context(), file)
					if !slices.EqualFunc(before, after, func(a, b *ast.Diagnostic) bool {
						return a.Code() == b.Code() && a.Pos() == b.Pos() && a.MessageText() == b.MessageText()
					}) {
						t.Fatal("semantic checking changed syntax diagnostics")
					}
				}
			})
		}
	}
}

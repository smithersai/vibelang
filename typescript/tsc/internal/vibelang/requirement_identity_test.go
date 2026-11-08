package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
)

func requirementIdentityProgram(t *testing.T, source string, dependencies map[string]string) (*compiler.Program, *ast.SourceFile, *ls.LanguageService, *lsconv.Converters) {
	t.Helper()
	program, file, _, converters := editorProgram(t, source)
	for name, text := range dependencies {
		if err := os.WriteFile(filepath.Join(filepath.Dir(string(file.FileName())), name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	program = compiler.NewProgram(compiler.ProgramOptions{Config: program.CommandLine(), Host: program.Host()})
	file = program.GetSourceFile(file.FileName())
	return program, file, ls.NewLanguageService(nil, program, editorTestHost{converters: converters}, string(file.FileName())), converters
}

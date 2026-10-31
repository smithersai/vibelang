package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestHelperReturnFixQualifiesImportedType(t *testing.T) {
	source := "import * as foreign from './foreign.js';\nfunction helper(){return new foreign.Thing()}\nexport function caller():foreign.Thing{return helper()}\n"
	initial, file, _, _ := editorProgram(t, source)
	if err := os.WriteFile(filepath.Join(filepath.Dir(file.FileName().AsString()), "foreign.ts"), []byte("export class Thing {readonly value=1}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	program := compiler.NewProgram(compiler.ProgramOptions{Config: initial.CommandLine(), Host: compiler.NewCompilerHost(fs, initial.Host().DefaultLibraryPath(), nil, nil, nil)})
	result := FixProject(t.Context(), fs, bundled.LibPath(), program.CommandLine())
	fixed := result.Files[file.FileName()]
	if fixed == nil || result.Err != nil {
		t.Fatalf("qualified helper annotation was refused: %+v", result)
	}
	if strings.Contains(fixed.Text, "helper(): Thing") {
		t.Fatalf("wrote a name not in scope: %s", fixed.Text)
	}
	if !strings.Contains(fixed.Text, "helper(): foreign.Thing") && !strings.Contains(fixed.Text, "helper(): infer _") {
		t.Fatalf("missing writable return type: %s", fixed.Text)
	}
}

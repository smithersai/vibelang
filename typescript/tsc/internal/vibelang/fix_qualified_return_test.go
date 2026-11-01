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

// The helper return-type fix answered EK9203, D67's plain annotation that
// calls an unannotated helper. VIP-1 makes the unmarked helper plain, so the
// project compiles and --fix has nothing to write; were the fix to return, it
// must write foreign.Thing, never a name not in scope.
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
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("--fix failed: %+v", result)
	}
	if fixed == nil {
		return
	}
	if strings.Contains(fixed.Text, "helper(): Thing") {
		t.Fatalf("wrote a name not in scope: %s", fixed.Text)
	}
	if !strings.Contains(fixed.Text, "helper(): foreign.Thing") && !strings.Contains(fixed.Text, "helper(): infer _") {
		t.Fatalf("missing writable return type: %s", fixed.Text)
	}
}

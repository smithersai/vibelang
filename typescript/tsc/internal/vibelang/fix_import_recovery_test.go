package vibelang

import (
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// After its fixes, --fix removes the effect imports they left unused. An
// import that parses with a module specifier that is no string, as
// `import * ct.sleeon from "effect/Option"` recovers to, names no module: the
// cleanup skips it instead of panicking on its text.
func TestFixSkipsAnImportWithoutAStringSpecifier(t *testing.T) {
	_, file, _, _ := editorProgram(t, "import * ct.sleeon from \"effect/Option\"\n  const checked: Option.Option<void> = try Effect.option(guard())\n")
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{})
}

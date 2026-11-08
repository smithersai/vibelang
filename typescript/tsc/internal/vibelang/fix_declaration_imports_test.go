package vibelang

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// declarationImports returns the import lines of main.d.ts, which the
// project of config emits.
func declarationImports(t *testing.T, config string) string {
	t.Helper()
	dts := declarationText(t, config)
	var imports []string
	for line := range strings.Lines(dts) {
		if strings.HasPrefix(line, "import ") {
			imports = append(imports, strings.TrimSpace(line))
		}
	}
	return strings.Join(imports, "\n")
}

// declarationText returns the main.d.ts that the project of config emits.
func declarationText(t *testing.T, config string) string {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(config)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	var dts string
	p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(name), "main.d.ts") {
			dts = text
		}
		return nil
	}})
	if dts == "" {
		t.Fatal("no main.d.ts emitted")
	}
	return dts
}

// generatedThrowsBlock is VIP-27's generated contract as a block of its own,
// written where a signature has no authored JSDoc. Authored tags differ.
var generatedThrowsBlock = regexp.MustCompile(`/\*\* @throws \{never\} \*/\s*`)

// generatedThrowsLineBreak is that contract after a token its function type
// follows on the same line, where the printer starts it on a line of its own
// so that it stays attached when the declarations reload (7d8785b65f8b).
var generatedThrowsLineBreak = regexp.MustCompile(`([(=>?:|,][ \t]*)\n[ \t]*/\*\* @throws \{never\} \*/\s*`)

// withoutGeneratedThrows removes the one declaration difference API identity
// allows against the TypeScript twin.
func withoutGeneratedThrows(declaration string) string {
	declaration = generatedThrowsLineBreak.ReplaceAllString(declaration, "$1")
	return generatedThrowsBlock.ReplaceAllString(declaration, "")
}

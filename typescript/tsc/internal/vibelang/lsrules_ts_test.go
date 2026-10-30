package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// D266: ordinary TypeScript keeps TypeScript's diagnostics. Error recovery
// parses the function below as the import's module specifier, which
// TypeScript never checks, so it reports nothing inside it; the EK4801
// walk asked the checker for a type there and reported TS2304 at missingName.
func TestTypeScriptFileKeepsTypeScriptsDiagnostics(t *testing.T) {
	const source = "import { both } from\nfunction shown() {\n  missingName\n}\nmissingTop\n"
	fs := bundled.WrapFS(vfstest.FromMap(map[string]any{
		"/project/tsconfig.json": `{"compilerOptions":{"strict":true,"noEmit":true,"types":[]},"files":["main.ts"]}`,
		"/project/main.ts":       source,
	}, tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	var got []string
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "main.ts") {
			got = append(got, fmt.Sprintf("TS%d %s", d.Code(), source[d.Pos():d.End()]))
		}
	}
	// Stock TypeScript 7.1 reports these two, and nothing at missingName.
	if want := []string{"TS1141 shown", "TS2304 missingTop"}; !slices.Equal(got, want) {
		t.Fatalf("got %q, want TypeScript's %q", got, want)
	}
}

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

// TestThrowAdvisoriesOnlyInEffectFunctions checks that EK4804, EK4811 and
// EK4815, the advisories about what a typed failure fails with, report only
// an Effect function's throw (VIP-4). A plain function's throw is EK0401
// (Plain code never throws, chapter 3), and none of these advisories is about
// it: the plain functions below report it and no advisory. Every function has
// the same form with or without VIP-1's marked-only rule: the plain ones have
// a plain return annotation (D500).
func TestThrowAdvisoriesOnlyInEffectFunctions(t *testing.T) {
	t.Parallel()
	const source = `export function plainError(x: number): number {
  if (x < 0) throw new Error("negative")
  return x
}
export const plainArrow = (cause: unknown): number => {
  throw cause
}
export function plainRange(x: number): number {
  if (x > 9) throw new RangeError("large")
  return x
}
export effect function effectError(x: number) {
  if (x < 0) throw new Error("negative")
  return x
}
`
	fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(map[string]string{
		"/main.vibe":     source,
		"/tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true }, "files": ["main.vibe"] }`,
	}), tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("tsconfig: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	// owner names the exported function whose text holds pos.
	owner := func(pos int) string {
		name := ""
		for _, candidate := range []string{"plainError", "plainArrow", "plainRange", "effectError"} {
			if at := strings.Index(source, candidate); at >= 0 && at <= pos {
				name = candidate
			}
		}
		return name
	}
	var got []string
	for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
		switch d.Code() {
		case EK4804.Code, EK4811.Code, EK4815.Code:
			got = append(got, fmt.Sprintf("EK%d in %s", d.Code(), owner(d.Pos())))
		}
	}
	slices.Sort(got)
	if want := []string{"EK4804 in effectError"}; !slices.Equal(got, want) {
		t.Fatalf("throw advisories %q, want only the Effect function's %q", got, want)
	}
}

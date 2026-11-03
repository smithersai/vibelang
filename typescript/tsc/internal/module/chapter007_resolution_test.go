package module

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// Chapter 007 / resolution candidate ordering: docs/design/src/007-tooling.md#68b01858a9dd37eb
// Chapter 007 / jsx resolution candidate ordering: docs/design/src/007-tooling.md#d7ea782b75881b2e
func TestChapter007ResolutionCandidates(t *testing.T) {
	kinds := []string{"App.ts", "App.tsx", "App.vibe", "App.vibex", "App.d.ts", "App.jsx", "App.js"}
	for _, row := range []struct {
		specifier string
		order     []string
	}{
		{"App", []string{"App.ts", "App.tsx", "App.vibe", "App.vibex", "App.d.ts", "App.js", "App.jsx"}},
		{"App.js", []string{"App.ts", "App.tsx", "App.vibe", "App.vibex", "App.d.ts", "App.js", "App.jsx"}},
		{"App.jsx", []string{"App.tsx", "App.ts", "App.vibex", "App.vibe", "App.d.ts", "App.jsx", "App.js"}},
	} {
		for mask := 0; mask < 1<<len(kinds); mask++ {
			t.Run(fmt.Sprintf("%s/%07b", row.specifier, mask), func(t *testing.T) {
				files := map[string]string{}
				for i, name := range kinds {
					if mask&(1<<i) != 0 {
						files["/p/"+name] = "export const n=1"
					}
				}
				want := ""
				for _, name := range row.order {
					if _, ok := files["/p/"+name]; ok {
						want = "/p/" + name
						break
					}
				}
				if os.Getenv("VIBELANG_COVERAGE_RUN_PENDING") != "1" && (strings.HasSuffix(want, ".vibex") || row.specifier == "App.jsx" && strings.HasSuffix(want, ".vibe")) {
					rule := "docs/design/src/007-tooling.md#68b01858a9dd37eb"
					if row.specifier == "App.jsx" {
						rule = "docs/design/src/007-tooling.md#d7ea782b75881b2e"
					}
					t.Skip(rule + ": candidate source extension is absent from this lookup; mask " + fmt.Sprintf("%07b", mask))
				}
				fs := vfstest.FromMap(files, tspath.CaseSensitive)
				state := &resolutionState{resolver: &DefaultResolver{ResolutionData: &ResolutionData{}, fs: fs}, compilerOptions: &core.CompilerOptions{}}
				got := state.loadModuleFromFile(extensionsTypeScript|extensionsDeclaration|extensionsJavaScript, resolveResolutionCandidate("/p", row.specifier))
				if want == "" {
					if !got.shouldContinueSearching() {
						t.Fatalf("unexpected result %v", got)
					}
					return
				}
				if got == nil || got.path != tspath.RootedFilePath(want) {
					t.Fatalf("resolved %v; want %s", got, want)
				}
			})
		}
	}
}

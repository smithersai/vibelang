package module

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// Written TypeScript source paths keep their native substitutions.
func TestWrittenNativeSourceNeverSelectsVibe(t *testing.T) {
	for _, extension := range []string{".ts", ".tsx"} {
		for mask := 0; mask < 8; mask++ {
			t.Run(fmt.Sprintf("%s/%d", extension, mask), func(t *testing.T) {
				files := map[string]string{"/repo/main.ts": "", "/repo/target.vibe": "", "/repo/target.vibex": ""}
				order := []string{".ts", ".tsx", ".d.ts"}
				if extension == ".tsx" {
					order[0], order[1] = order[1], order[0]
				}
				want := ""
				for i, candidate := range order {
					if mask&(1<<i) != 0 {
						path := "/repo/target" + candidate
						files[path] = ""
						if want == "" {
							want = path
						}
					}
				}
				fs := vfstest.FromMap(files, tspath.CaseSensitive)
				resolver := NewResolver(ResolverOptions{
					Host:            &resolutionTestInputs{fs: fs, cwd: "/repo"},
					CompilerOptions: &core.CompilerOptions{ModuleResolution: core.ModuleResolutionKindBundler},
				})
				got, _, err := resolver.ResolveModuleName("./target"+extension, "/repo/main.ts", core.ModuleKindESNext, nil)
				if err != nil {
					t.Fatal(err)
				}
				if string(got.ResolvedFileName) != want {
					t.Fatalf("resolved %q, want native target %q", got.ResolvedFileName, want)
				}
			})
		}
	}
}

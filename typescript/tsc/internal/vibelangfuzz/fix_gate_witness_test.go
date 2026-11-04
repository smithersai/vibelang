package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Every cross-file witness must actually refuse the narrowing rewrite.
// Otherwise the differential gate oracle can agree without exercising it.
func TestFixGateRefusalWitnesses(t *testing.T) {
	w := NewWorkspace(t)
	for _, key := range []string{"cross", "hidden"} {
		for _, index := range []int{0, 3, 5} {
			for _, each := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/index%d/each%t", key, index, each), func(t *testing.T) {
					files := fixGateProject(strings.Repeat("good,", index) + key)
					r := toolsCompile(t, w, "TestFixGateRefusalWitnesses", files)
					defer r.Remove()
					config := toolsConfig(w, r.Dir)
					if config == nil || len(config.Errors) > 0 {
						t.Fatalf("invalid witness config: %+v", config)
					}
					result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{CheckEachFix: each})
					t.Logf("original diagnostics: %v; refusals: %+v", r.Diagnostics, result.Refused)
					if result.Err != nil {
						t.Fatal(result.Err)
					}
					if len(result.Refused) != 1 {
						t.Fatalf("want one cross-file narrowing refusal, got %+v\n%s", result.Refused, Archive(files))
					}
					refused := result.Refused[0]
					if refused.Code != 4834 || filepath.Base(refused.File.AsString()) != fmt.Sprintf("modes%d.vibe", index) || !strings.Contains(refused.Error, fmt.Sprintf("uses%d.vibe", index)) {
						t.Fatalf("want EK4834 refused for the importing file, got %+v", refused)
					}
					for name, fixed := range result.Files {
						if filepath.Base(name.AsString()) == fmt.Sprintf("modes%d.vibe", index) && fixed.Counts[4834] != 0 {
							t.Fatalf("applied the refused narrowing: %s", fixed.Text)
						}
					}
				})
			}
		}
	}
}

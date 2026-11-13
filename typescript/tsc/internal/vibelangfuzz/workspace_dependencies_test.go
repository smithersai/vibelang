package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Capture Missing through the real testing.TB path without making an expected
// skip skip the enclosing regression or requiring a built runtime.
type workspaceMissingTB struct {
	testing.TB
	message  string
	required bool
}
type workspaceMissing struct{}

func (t *workspaceMissingTB) Skipf(format string, args ...any) {
	t.message = fmt.Sprintf(format, args...)
	panic(workspaceMissing{})
}
func (t *workspaceMissingTB) Fatalf(format string, args ...any) {
	t.required = true
	t.message = fmt.Sprintf(format, args...)
	panic(workspaceMissing{})
}

func TestWorkspaceTypeScriptDependency(t *testing.T) {
	for _, version := range []string{"", "0.0.0", "malformed"} {
		for _, required := range []string{"", "1"} {
			t.Run(version+"/require="+required, func(t *testing.T) {
				modules := t.TempDir()
				write := func(name, source string) {
					p := filepath.Join(modules, name, "package.json")
					if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(p, []byte(source), 0600); err != nil {
						t.Fatal(err)
					}
				}
				write("effect", fmt.Sprintf("{\"version\":%q}", PinnedEffectVersion()))
				if version != "" {
					manifest := fmt.Sprintf("{\"version\":%q}", version)
					if version == "malformed" {
						manifest = "{"
					}
					write("typescript", manifest)
				}
				t.Setenv("EFFECT_NODE_MODULES", modules)
				t.Setenv("VIBELANG_FUZZ_REQUIRE", required)
				tb := &workspaceMissingTB{TB: t}
				func() {
					defer func() {
						if p := recover(); p != nil {
							if _, ok := p.(workspaceMissing); !ok {
								panic(p)
							}
						}
					}()
					NewWorkspace(tb)
				}()
				if !strings.Contains(tb.message, "typescript") || !strings.Contains(tb.message, "bun install") {
					t.Fatalf("missing stock compiler was not diagnosed: %s", tb.message)
				}
				if tb.required != (required == "1") {
					t.Fatalf("Missing failure=%v with require=%q", tb.required, required)
				}
			})
		}
	}
}

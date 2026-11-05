package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// TestRegistryDebtWitnessIdentity checks pending-witness receipts, not the
// expected diagnostics of valid programs. Appendix B says: "A transitional
// compiler may still print compatibility diagnostics from the old language."
// These codes retain their interim inventory rows. VIP-26 replaced the
// implicit module execution behind EK1001: that saved source must now retain
// its explicit-try and service-shape errors without the obsolete execution
// error. The other witnesses still reach their named compatibility debt.
func TestRegistryDebtWitnessIdentity(t *testing.T) {
	const quote = "A transitional compiler may still print compatibility diagnostics from the old language."
	chapter, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), quote) {
		t.Fatalf("Appendix B no longer contains %q", quote)
	}
	w := NewWorkspace(t)
	for _, code := range []int32{1001, 4602, 4603} {
		for _, target := range []string{"FuzzCompile", "FuzzSplice"} {
			t.Run(fmt.Sprintf("%s/%s", target, specCodeName(code)), func(t *testing.T) {
				if !Facts().IsRegistered(code) || !slices.Contains(Facts().Interim, code) {
					t.Fatalf("%s must retain its interim identity row", specCodeName(code))
				}
				name := fmt.Sprintf("registry-EK%04d", code)
				data, err := os.ReadFile(filepath.Join(repoTestdata(), "fuzz", target, name))
				if err != nil {
					t.Fatal(err)
				}
				lines := strings.Split(strings.TrimSpace(string(data)), "\n")
				if len(lines) != 2 || !strings.HasPrefix(lines[1], "string(") || !strings.HasSuffix(lines[1], ")") {
					t.Fatalf("%s: want one string fuzz argument", name)
				}
				archive, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "string("), ")"))
				if err != nil {
					t.Fatal(err)
				}
				project := ProjectFromArchive(archive)
				if code == 1001 {
					// Keep the unkeyed-service control independent of the
					// enclosing test workspace's package identity.
					project.Files["package.json"] = `{"type":"module"}`
				}
				c, err := w.CompileOrdered(t.Context(), project, OrderTsc, true)
				if err != nil {
					t.Fatal(err)
				}
				defer c.Remove()
				var actual []string
				found := false
				for _, d := range c.Diagnostics {
					if d.Source() == "EK" {
						actual = append(actual, specCodeName(d.Code()))
						found = found || d.Code() == code
					}
				}
				if code == 1001 {
					TestModuleColdCallTypesQuoted(t)
					if found || !slices.Contains(actual, "EK0501") || !slices.Contains(actual, "EK0903") {
						t.Fatalf("%s/%s must keep the current explicit-try and service-shape controls without implicit execution; emitted %v", target, name, actual)
					}
				} else if !found {
					var all []string
					for _, d := range c.Diagnostics {
						if IsEK(d) {
							all = append(all, specCodeName(d.Code()))
						} else {
							all = append(all, fmt.Sprintf("TS%d", d.Code()))
						}
					}
					t.Fatalf("%s/%s no longer reaches its named registry debt; emitted %v", target, name, all)
				}
			})
		}
	}
}

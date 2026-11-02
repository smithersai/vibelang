package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// TestRegistryDebtWitnessIdentity checks pending-witness receipts, not the
// expected diagnostics of valid programs. Appendix B says: "A transitional
// compiler may still print compatibility diagnostics from the old language."
// These unassigned codes remain rejected by Facts. A differently named known
// violation must not conceal a stale witness when another compiler rule changes.
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
				if Facts().IsRegistered(code) {
					t.Fatalf("%s now has an assignment; reconcile its pending witness", specCodeName(code))
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
				c, err := w.CompileOrdered(t.Context(), ProjectFromArchive(archive), OrderTsc, true)
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
				if !found {
					t.Fatalf("%s/%s no longer reaches its named registry debt; emitted %v", target, name, actual)
				}
			})
		}
	}
}

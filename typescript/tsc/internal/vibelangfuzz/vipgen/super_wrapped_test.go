package vipgen

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Named seeds must keep exercising each wrapper on calls, computed calls,
// optional calls and template tags when the generator's registry changes.
func TestSuperWrappedCorpusCoversReferences(t *testing.T) {
	wrappers := []string{"!", "(super", " as typeof ", " satisfies typeof ", "(<typeof ", " as typeof "}
	for shape := range 4 {
		for wrapper, spelling := range wrappers {
			t.Run(fmt.Sprintf("%d/%d", shape, wrapper+1), func(t *testing.T) {
				path := filepath.Join("..", "testdata", "fuzz", "FuzzVIPDifferential", fmt.Sprintf("super-wrapped-%d-%d", shape, wrapper+1))
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				lines := strings.SplitN(strings.TrimSpace(string(data)), "\n", 2)
				if len(lines) != 2 {
					t.Fatal("invalid fuzz corpus")
				}
				input, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
				if err != nil {
					t.Fatal(err)
				}
				p := Generate([]byte(input), nil)
				if p == nil || p.Focus != "vip01.super" {
					t.Fatal("corpus no longer selects super invocation")
				}
				vibe, native := PrintVibe(p), PrintEffect(p)
				if !strings.Contains(vibe, spelling) {
					t.Fatalf("missing wrapper %q:\n%s", spelling, vibe)
				}
				for _, source := range []string{vibe, native} {
					switch shape {
					case 1:
						if !strings.Contains(source, "super[(ev(") || !strings.Contains(source, "(...[") {
							t.Fatalf("missing computed spread call:\n%s", source)
						}
					case 2:
						if !strings.Contains(source, "?.(") {
							t.Fatalf("missing optional call:\n%s", source)
						}
					case 3:
						if !strings.Contains(source, "super.tag") {
							t.Fatalf("missing template tag:\n%s", source)
						}
					}
				}
				if !strings.Contains(native, "const invoke = () => (super.") && shape != 1 {
					t.Fatalf("reference lost native receiver:\n%s", native)
				}
			})
		}
	}
}

package vipgen

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Check the generated programs, so keyed seeds cannot silently lose their
// promised nesting or accidentally compare VibeLang with itself.
func TestForOfCloseCorpusDepths(t *testing.T) {
	for depth := 1; depth <= 3; depth++ {
		for mode := range 4 {
			name := fmt.Sprintf("for-of-close-depth-%d-mode-%d", depth, mode)
			t.Run(name, func(t *testing.T) {
				data, err := os.ReadFile(filepath.Join("..", "testdata/fuzz/FuzzVIPDifferential", name))
				if err != nil {
					t.Fatal(err)
				}
				lines := strings.SplitN(strings.TrimSpace(string(data)), "\n", 2)
				if len(lines) != 2 {
					t.Fatal("missing fuzz corpus header")
				}
				input, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
				if err != nil {
					t.Fatal(err)
				}
				p := Generate([]byte(input), nil)
				if p == nil || p.Focus != "vip31.for-of-close-plain" || !p.Plain {
					t.Fatal("corpus lost its plain closing probe")
				}
				source, reference := PrintVibe(p), PrintEffect(p)
				if strings.Count(source, "for (const ") != depth {
					t.Fatalf("lost depth %d:\n%s", depth, source)
				}
				if !strings.Contains(source, "value === e") || !strings.Contains(source, "events])") {
					t.Fatalf("lost identity or event oracle:\n%s", source)
				}
				if !strings.Contains(reference, "transpileModule") || !strings.Contains(reference, "new Function") {
					t.Fatalf("reference no longer uses stock tsc:\n%s", reference)
				}
			})
		}
	}
}

package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

// Corpus choices can drift when the registry or generator changes. Keep a
// reached main-body witness for every member/key/context combination.
func TestVIPObjectMemberKeyCorpusCoverage(t *testing.T) {
	dir := filepath.Join(Root(), "typescript", "tsc", "internal", "vibelangfuzz", "testdata", "fuzz", "FuzzVIPDifferential")
	files, err := filepath.Glob(filepath.Join(dir, "object-member-key-*"))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, file := range files {
		text, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		line := strings.TrimSpace(strings.TrimPrefix(string(text), "go test fuzz v1\n"))
		if !strings.HasPrefix(line, "[]byte(") || !strings.HasSuffix(line, ")") {
			t.Fatalf("bad byte corpus %s", filepath.Base(file))
		}
		data, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(line, "[]byte("), ")"))
		if err != nil {
			t.Fatal(err)
		}
		p := vipgen.Generate([]byte(data), nil)
		if p == nil || p.Focus != "vip01.object-member-key" || len(p.Funcs) == 0 {
			t.Fatalf("lost focus %s", filepath.Base(file))
		}
		main := p.Funcs[len(p.Funcs)-1]
		if len(main.Body) == 0 {
			t.Fatal("empty main body")
		}
		code, ok := main.Body[0].(*vipgen.Code)
		if !ok {
			t.Fatal("focus no longer begins main")
		}
		mode, _, ok := strings.Cut(code.V, "\n")
		if !ok || !strings.HasPrefix(mode, "// object-member-key ") {
			t.Fatal("missing reached variant")
		}
		if !strings.HasPrefix(code.E, mode+"\n") || !strings.Contains(code.V, "[try Effect.sync(") || !strings.Contains(code.E, "[yield* Effect.sync(") {
			t.Fatalf("missing key operation %s", filepath.Base(file))
		}
		seen[strings.TrimPrefix(mode, "// object-member-key ")] = true
	}
	for _, shape := range []string{"method", "getter", "setter", "effect-method", "property"} {
		for _, key := range []string{"string", "symbol", "coercion"} {
			for _, nested := range []string{"false", "true"} {
				mode := shape + "/" + key + "/nested=" + nested
				if !seen[mode] {
					t.Errorf("missing corpus variant %s", mode)
				}
			}
		}
	}
	if len(files) != 30 || len(seen) != 30 {
		t.Fatalf("files %d variants %d; want 30", len(files), len(seen))
	}
}

package grammaradmission

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func repositoryRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for ; dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, Table)); err == nil {
			return dir
		}
	}
	t.Fatal("no repository root above the working directory")
	return ""
}

func TestTableAccountsForEveryHook(t *testing.T) {
	root := repositoryRoot(t)
	hooks, err := Hooks(root)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, Table))
	if err != nil {
		t.Fatal(err)
	}
	specPath := func(chapter string) string { return filepath.Join(root, "docs/design/src", chapter) }
	errs, _ := Check(hooks, string(data), specPath)
	for _, e := range errs {
		t.Error(e)
	}
	if len(hooks) < 100 {
		t.Fatalf("the census found only %d hooks; it no longer reads the compiler", len(hooks))
	}
}

// A hook with no row fails alone, and a duplicate row fails: the two failures
// main f2e20124cb5d carried for hours because only post-merge ran this check.
func TestCheckRejectsUnaccountedAndDuplicateHooks(t *testing.T) {
	specPath := func(chapter string) string { return filepath.Join(t.TempDir(), chapter) }
	row := "parser/vibelang_a.go:Parser.a\tadmission:a\t-\tpending\tr\n"
	errs, _ := Check(map[string]bool{"parser/vibelang_a.go:Parser.a": true, "vibelang/x_lower.go:serviceHead": true}, row+row, specPath)
	joined := strings.Join(errs, "\n")
	for _, want := range []string{"duplicate hook parser/vibelang_a.go:Parser.a", "unaccounted syntax/lowering hook vibelang/x_lower.go:serviceHead"} {
		if !strings.Contains(joined, want) {
			t.Errorf("errors %q lack %q", joined, want)
		}
	}
}

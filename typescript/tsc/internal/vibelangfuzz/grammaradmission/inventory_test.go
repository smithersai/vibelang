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

// Private legacy decoding is recovery under VIP-11, never language admission.
// Keep this focused census in addition to the complete inventory check so a
// helper move cannot silently leave stale rows that only describe old symbols.
func TestLegacyTrailingBlockHooksAreRecovery(t *testing.T) {
	root := repositoryRoot(t)
	hooks, err := Hooks(root)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, Table))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		"parser/vibelang_trailing_legacy.go:Parser.isLegacyTrailingBlockStart": true,
		"parser/vibelang_trailing_legacy.go:Parser.parseLegacyTrailingBlock":   true,
		"parser/vibelang_trailing_legacy.go:isLegacyTrailingBlockHead":         true,
	}
	for hook := range want {
		if !hooks[hook] {
			t.Errorf("private recovery hook %s is absent from the compiler census", hook)
		}
	}
	specPath := func(chapter string) string { return filepath.Join(root, "docs/design/src", chapter) }
	errs, _ := Check(want, string(data), specPath)
	for _, err := range errs {
		t.Error(err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) == 5 && want[fields[0]] {
			if fields[1] != "admission:trailing-block" || fields[2] != "900-appendices.md" || fields[3] != "recovery" {
				t.Errorf("private trailing-block decoder must remain VIP-11 recovery: %s", line)
			}
		}
	}
}

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
	// One subtest per hook, so a gate that tolerates the failures main is red
	// on still rejects a commit that adds another unaccounted hook. Under one
	// test name, 8341e3fa217c's six new hooks landed while main was red here.
	for _, e := range errs {
		t.Run(inventoryErrorKey(e), func(t *testing.T) { t.Error(e) })
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

// inventoryErrorKey names a Check error by the hook or table line it is about.
func inventoryErrorKey(e string) string {
	e = strings.TrimPrefix(strings.TrimPrefix(e, "unaccounted syntax/lowering hook "), "duplicate hook ")
	f := strings.Fields(e)
	if len(f) == 0 {
		return e
	}
	if f[0] == "line" && len(f) > 1 {
		return "line " + strings.TrimRight(f[1], ":")
	}
	return strings.TrimRight(f[0], ";:")
}

func TestInventoryErrorKeyNamesTheHook(t *testing.T) {
	for _, c := range []struct{ err, want string }{
		{"unaccounted syntax/lowering hook parser/vibelang_a.go:Parser.a; add its spec authority or pending admission:<form>", "parser/vibelang_a.go:Parser.a"},
		{"unaccounted syntax/lowering hook vibelang/x_lower.go:serviceHead; add its spec authority or pending admission:<form>", "vibelang/x_lower.go:serviceHead"},
		{"duplicate hook parser/vibelang_a.go:Parser.a", "parser/vibelang_a.go:Parser.a"},
		{"parser/vibelang_a.go:Parser.a: missing form/reason", "parser/vibelang_a.go:Parser.a"},
		{"vibelang/h.go:hatchOf: invalid status maybe", "vibelang/h.go:hatchOf"},
		{"line 7: want hook, form, authority, status, reason", "line 7"},
	} {
		if got := inventoryErrorKey(c.err); got != c.want {
			t.Errorf("inventoryErrorKey(%q) = %q, want %q", c.err, got, c.want)
		}
	}
	a := inventoryErrorKey("unaccounted syntax/lowering hook parser/a.go:Parser.a; x")
	b := inventoryErrorKey("unaccounted syntax/lowering hook parser/a.go:Parser.b; x")
	if a == b {
		t.Errorf("two hooks share the subtest name %q", a)
	}
}

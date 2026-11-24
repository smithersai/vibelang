package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// A table refresh may change users' evaluation boundaries. The gate must
// require an approval for each changed site/kind, not let one approval cover
// another callback. Changes in the form's evidence also require review, while
// adding and removing sites does not change a decision at an existing site.
func TestDecisionMovesRequireExactApprovals(t *testing.T) {
	previous := []string{
		"z.vibe:2:1 lambda plain table",
		"z.vibe:10:1 lambda dual fallback",
		"a.vibe:1:1 block appended/program table",
		"a.vibe:1:1 lambda plain fallback",
		"removed.vibe:1:1 lambda plain table",
		"stable.vibe:1:1 lambda plain fallback",
	}
	next := []string{
		"z.vibe:10:1 lambda effectFn table",
		"z.vibe:18:1 lambda dual fallback",
		"a.vibe:1:1 block applied/program table",
		"a.vibe:1:1 lambda plain table",
		"added.vibe:1:1 lambda effectFn table",
		"stable.vibe:1:1 lambda plain fallback",
	}
	want := []string{"a.vibe:1:1 block: appended/program table -> applied/program table", "a.vibe:1:1 lambda: plain fallback -> plain table", "z.vibe:10:1 lambda: plain table -> effectFn table"}
	if got := unapprovedMoves(previous, next, nil); !reflect.DeepEqual(got, want) {
		t.Fatalf("moves %v, want %v", got, want)
	}
	approved := []string{" a.vibe:1:1   block: appended/program table -> applied/program table # checked D188", "z.vibe:10:1 lambda: effectFn table -> plain table # wrong direction"}
	if got := unapprovedMoves(previous, next, approved); !reflect.DeepEqual(got, want[1:]) {
		t.Fatalf("unapproved %v, want %v", got, want[1:])
	}
	approved = append(approved, "a.vibe:1:1 lambda: plain fallback -> plain table # checked table evidence", "z.vibe:10:1 lambda: plain table -> effectFn table # checked callback contract")
	if got := unapprovedMoves(previous, next, approved); len(got) != 0 {
		t.Fatalf("approved moves rejected: %v", got)
	}
	for _, reason := range []string{"", " #", " #   "} {
		if got := unapprovedMoves(previous, next, []string{want[2] + reason}); !reflect.DeepEqual(got, want) {
			t.Fatalf("blank reason %q approved a move: %v", reason, got)
		}
	}
	if got := unapprovedMoves(previous, next, freshApprovals(approved, approved)); !reflect.DeepEqual(got, want) {
		t.Fatalf("historical approvals covered a repeated move: %v", got)
	}

}

func TestDecisionSnapshotFileRoundTrip(t *testing.T) {
	file := filepath.Join(t.TempDir(), "decisions.txt")
	want := []string{"a.vibe:1:1 lambda plain table", "a.vibe:2:1 byname program table"}
	if err := writeLines(file, want); err != nil {
		t.Fatal(err)
	}
	got, err := readLines(file)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("read %v, %v; want %v", got, err, want)
	}
	if err := os.WriteFile(file, []byte("# approvals\n\n  a.vibe:1:1 lambda: plain -> effectFn # reviewed\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err = readLines(file)
	if err != nil || !reflect.DeepEqual(got, []string{"a.vibe:1:1 lambda: plain -> effectFn # reviewed"}) {
		t.Fatalf("approval comments/blank lines: %v, %v", got, err)
	}
	if _, err := readLines(file + ".missing"); err != nil {
		t.Fatalf("missing initial snapshot: %v", err)
	}
	if err := writeLines(filepath.Join(file, "blocked"), want); err == nil {
		t.Fatal("snapshot write failure was ignored")
	}
}

// Refresh locally with UPDATE_FORMS_GOLDENS=1 go test -run ^TestDecisionSnapshotGolden$.
// The refresh fails deliberately. Rerun with the variable unset to verify.
func TestDecisionSnapshotGolden(t *testing.T) {
	if os.Getenv("UPDATE_FORMS_GOLDENS") == "1" && os.Getenv("CI") != "" {
		t.Fatal("UPDATE_FORMS_GOLDENS is disabled under CI")
	}
	root := t.TempDir()
	const source = `const result = Effect.map(Effect.succeed(1), (n) => n + 1)
function f() { return Effect.forkChild(effect { read() }) }
function g(xs: Items) { xs.forEach((x) => { log(x); read(x) }) }
`
	writeFixture(t, root, "examples/main.vibe", source)
	writeFixture(t, root, "examples/node_modules/ignored/main.vibe", source)
	writeFixture(t, root, "examples/.hidden/main.vibe", source)
	writeFixture(t, root, "examples/out/p-warning/main.vibe", source)
	writeFixture(t, root, "examples/ignored.ts", source)
	table, err := vibelangmapper.DefaultTable()
	if err != nil {
		t.Fatal(err)
	}
	lines, err := decisionLines(root, table)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(lines, "\n") + "\n"
	golden := filepath.Join("testdata", "decisions.txt")
	if os.Getenv("UPDATE_FORMS_GOLDENS") == "1" {
		if err := os.MkdirAll(filepath.Dir(golden), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(golden, []byte(got), 0644); err != nil {
			t.Fatal(err)
		}
		t.Fatal("golden rewritten; rerun without UPDATE_FORMS_GOLDENS")
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Fatalf("decision snapshot:\ngot %s\nwant %s", got, want)
	}
}

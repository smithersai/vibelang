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

// A move from a decided form to a choice or a fallback makes the projector
// ask or guess where it decided before. Its approval must cite the issue that
// tracks the regression, not only the native compiler's behaviour (#518).
func TestWeakeningApprovalsCiteAnIssue(t *testing.T) {
	previous := []string{
		"a.vibe:1:1 lambda program annotation",
		"a.vibe:2:1 lambda plain fallback",
		"a.vibe:3:1 lambda plain hatch",
	}
	next := []string{
		"a.vibe:1:1 lambda plain fallback",
		"a.vibe:2:1 lambda choice fallback",
		"a.vibe:3:1 lambda effectFn table",
	}
	uncited := []string{
		"a.vibe:1:1 lambda: program annotation -> plain fallback # the native compiler runs it as before",
		"a.vibe:2:1 lambda: plain fallback -> choice fallback # another file's function may take either form",
		"a.vibe:3:1 lambda: plain hatch -> effectFn table # the table names an Effect function",
	}
	want := []string{"a.vibe:1:1 lambda: program annotation -> plain fallback (a decided form becomes a choice or fallback: the reason must cite a tracking issue, #N)"}
	if got := unapprovedMoves(previous, next, uncited); !reflect.DeepEqual(got, want) {
		t.Fatalf("uncited weakening: %v, want %v", got, want)
	}
	for _, reason := range []string{"tracked by #518", "see https://github.com/smithersai/vibelang/issues/518"} {
		cited := append([]string{"a.vibe:1:1 lambda: program annotation -> plain fallback # " + reason}, uncited[1:]...)
		if got := unapprovedMoves(previous, next, cited); len(got) != 0 {
			t.Fatalf("cited weakening %q rejected: %v", reason, got)
		}
	}
	// An HTML entity or a word with a hash is not an issue number.
	for _, reason := range []string{"see &#518", "c#2 rules"} {
		cited := append([]string{"a.vibe:1:1 lambda: program annotation -> plain fallback # " + reason}, uncited[1:]...)
		if got := unapprovedMoves(previous, next, cited); !reflect.DeepEqual(got, want) {
			t.Fatalf("%q counted as an issue citation: %v", reason, got)
		}
	}
	for entry, weakens := range map[string]bool{
		"a.vibe:1:1 lambda: program annotation -> plain fallback":    true,
		"a.vibe:1:1 lambda: effectFn table -> choice fallback":       true,
		"a.vibe:1:1 block: appended/program table -> choice keyword": true,
		"a.vibe:1:1 lambda: plain fallback -> choice fallback":       false,
		"a.vibe:1:1 lambda: choice fallback -> plain fallback":       false,
		"a.vibe:1:1 lambda: plain fallback -> effectFn table":        false,
		"a.vibe:1:1 lambda: plain hatch -> effectFn keyword":         false,
		"no move here": false,
	} {
		if got := weakensDecision(entry); got != weakens {
			t.Errorf("weakensDecision(%q) = %v, want %v", entry, got, weakens)
		}
	}
}

// One move needs one reviewed line: both modes, --write included, refuse an
// approvals file that names the same move twice (#518).
func TestDuplicateApprovalsAreRejected(t *testing.T) {
	approvals := []string{
		"a.vibe:1:1 lambda: plain fallback -> plain table # checked",
		"b.vibe:1:1 lambda: plain fallback -> plain table # checked",
		"a.vibe:1:1   lambda: plain fallback -> plain table # reworded reason",
		"c.vibe:1:1 lambda: dual fallback -> plain hatch # one",
		"c.vibe:1:1 lambda: dual fallback -> plain hatch # two",
		"c.vibe:1:1 lambda: dual fallback -> plain hatch # three",
	}
	want := []string{"a.vibe:1:1 lambda: plain fallback -> plain table", "c.vibe:1:1 lambda: dual fallback -> plain hatch"}
	if got := duplicateApprovals(approvals); !reflect.DeepEqual(got, want) {
		t.Fatalf("duplicates %v, want %v", got, want)
	}
	if got := duplicateApprovals(approvals[:2]); len(got) != 0 {
		t.Fatalf("distinct approvals reported as duplicates: %v", got)
	}
}

// The repository's approvals file carries each move once.
func TestCommittedApprovalsHaveNoDuplicates(t *testing.T) {
	approvals, err := readLines(filepath.Join("..", "..", "internal", "vibelangmapper", "forms_decisions_approved.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if len(approvals) == 0 {
		t.Fatal("no approvals read")
	}
	if got := duplicateApprovals(approvals); len(got) != 0 {
		t.Fatalf("duplicate approvals: %v", got)
	}
}

// The gate both script modes run refuses duplicates before it reads moves,
// so --write cannot record a snapshot over a doubled approval (#518).
func TestApprovalGateRefusesDuplicatesBeforeWriting(t *testing.T) {
	previous := []string{"a.vibe:1:1 lambda plain fallback"}
	next := []string{"a.vibe:1:1 lambda plain table"}
	once := []string{"a.vibe:1:1 lambda: plain fallback -> plain table # checked table evidence"}
	if problem, items := approvalGate(previous, next, once, nil, true, "approved.txt"); problem != "" {
		t.Fatalf("approved move refused: %s %v", problem, items)
	}
	twice := append(once, "a.vibe:1:1 lambda: plain fallback -> plain table # reworded")
	problem, items := approvalGate(previous, next, twice, nil, true, "approved.txt")
	if !strings.Contains(problem, "1 decision moves are approved more than once in approved.txt") || !reflect.DeepEqual(items, []string{"a.vibe:1:1 lambda: plain fallback -> plain table"}) {
		t.Fatalf("duplicate approval: %q %v", problem, items)
	}
	problem, items = approvalGate(previous, next, once, once, true, "approved.txt")
	if !strings.Contains(problem, "1 decisions moved without an approval") || len(items) != 1 {
		t.Fatalf("historical approval reused: %q %v", problem, items)
	}
}

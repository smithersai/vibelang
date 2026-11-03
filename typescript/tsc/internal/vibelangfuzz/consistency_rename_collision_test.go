package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
)

// TypeScript can separate colliding bindings during rename. Remaining collisions
// may switch between TS2451 and TS2300, but their total cannot increase.
// Other diagnostic changes remain failures.
func consistencyRenameDiagnosticDiff(before, after map[string]int) ([]string, string) {
	adjustedBefore, adjustedAfter := map[string]int{}, map[string]int{}
	maps.Copy(adjustedBefore, before)
	maps.Copy(adjustedAfter, after)
	totalsBefore, totalsAfter := map[string]int{}, map[string]int{}
	for _, group := range []struct{ counts, totals map[string]int }{{adjustedBefore, totalsBefore}, {adjustedAfter, totalsAfter}} {
		for key, count := range group.counts {
			for _, code := range []string{"TS2451", "TS2300"} {
				suffix := ": " + code + " (category 1)"
				if file, ok := strings.CutSuffix(key, suffix); ok {
					group.totals[file] += count
					delete(group.counts, key)
				}
			}
		}
	}
	for file, count := range totalsBefore {
		// Retain the original count when TypeScript repairs part of the collision.
		adjustedBefore[file+": TS2451 (category 1)"] = count
		adjustedAfter[file+": TS2451 (category 1)"] = max(count, totalsAfter[file])
		delete(totalsAfter, file)
	}
	for file, count := range totalsAfter {
		adjustedAfter[file+": TS2451 (category 1)"] = count
	}
	return consistencyCountDiff(adjustedBefore, adjustedAfter, false)
}

func TestConsistencyRenameCollisionQuoted(t *testing.T) {
	const quote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."
	if !strings.Contains(SpecText("000-intro.md"), quote) {
		t.Fatalf("the TypeScript counterpart rule no longer says %q", quote)
	}
}

func TestConsistencyRenameCollisionDiagnosticScope(t *testing.T) {
	duplicate := "main.vibe: TS2451 (category 1)"
	identifier := "main.vibe: TS2300 (category 1)"
	unrelated := "main.vibe: TS2304 (category 1)"
	for _, tc := range []struct {
		name          string
		before, after map[string]int
		want          string
	}{
		{"duplicate-removed", map[string]int{duplicate: 3}, nil, ""},
		{"duplicate-reduced", map[string]int{duplicate: 4}, map[string]int{duplicate: 2}, ""},
		{"identifier-removed", map[string]int{identifier: 2}, map[string]int{}, ""},
		{"duplicate-reclassified", map[string]int{duplicate: 3}, map[string]int{identifier: 2}, ""},
		{"reclassification-increased", map[string]int{duplicate: 2}, map[string]int{identifier: 3}, "TS2451"},
		{"other-file-added", map[string]int{duplicate: 3}, map[string]int{"other.vibe: TS2300 (category 1)": 2}, "TS2451"},
		{"duplicate-added", map[string]int{}, map[string]int{duplicate: 2}, "TS2451"},
		{"duplicate-increased", map[string]int{duplicate: 2}, map[string]int{duplicate: 3}, "TS2451"},
		{"other-error-removed", map[string]int{unrelated: 1}, map[string]int{}, "TS2304"},
		{"other-error-added", map[string]int{}, map[string]int{unrelated: 1}, "TS2304"},
		{"repair-does-not-hide-new-error", map[string]int{duplicate: 2}, map[string]int{unrelated: 1}, "TS2304"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before, after := maps.Clone(tc.before), maps.Clone(tc.after)
			diff, code := consistencyRenameDiagnosticDiff(before, after)
			if code != tc.want || (len(diff) == 0) != (tc.want == "") {
				t.Fatalf("diff = %v, code = %q; want code %q", diff, code, tc.want)
			}
			if !maps.Equal(before, tc.before) || !maps.Equal(after, tc.after) {
				t.Fatal("diagnostic comparison mutated its inputs")
			}
		})
	}
}

var consistencyCollisionKeys = []string{"schema-generic", "schema-interface", "schema-repeated", "native-const", "native-generic"}

func checkConsistencyRenameCollision(t *testing.T, w *Workspace, key string, variant uint8) {
	t.Helper()
	name := fmt.Sprintf("Item%d", variant%8)
	schema := "schema " + name + " { id: string }\n"
	canonical := "type " + name + " = typeof " + name + ".Type;\n"
	extension, first, second := ".vibe", schema, ""
	switch key {
	case "schema-generic":
		second = "type " + name + "<T> = typeof " + name + ".Type;\n"
	case "schema-interface":
		second = "interface " + name + " { id: string }\n"
	case "schema-repeated":
		second = canonical + canonical
	case "native-const":
		extension, first, second = ".ts", "const "+name+" = 1;\n", "const "+name+" = 2;\n"
	case "native-generic":
		extension = ".ts"
		first = "const " + name + " = { Type: '' };\n" + canonical
		second = "type " + name + "<T> = typeof " + name + ".Type;\n"
	default:
		t.Fatalf("unknown collision key %q", key)
	}
	if variant&8 != 0 {
		first, second = second, first
	}
	main := "main" + extension
	files := map[string]string{main: "export {};\n" + first + second}
	r := toolsCompile(t, w, consistencyTarget, files)
	defer r.Remove()
	hasDuplicate := false
	for _, d := range r.Diagnostics {
		hasDuplicate = hasDuplicate || d.Source() == "" && (d.Code() == 2451 || d.Code() == 2300)
	}
	if !hasDuplicate {
		t.Fatalf("collision control must report a duplicate declaration: %v", Keys(r.Dir, r.Diagnostics))
	}
	c := &consistency{t: t, ctx: t.Context(), w: w, main: main, archive: Archive(files)}
	c.before = c.project(r, files)
	for _, symbol := range c.symbols() {
		if symbol.name == name && len(symbol.refs) > 0 {
			probe := consistencyProbe{consistencySymbol: symbol, consistencyRef: symbol.refs[0]}
			refs := c.checkReferences(probe)
			if refs == nil {
				t.Fatal("duplicate binding must still receive reference checks")
			}
			c.checkRename(probe, refs)
			return
		}
	}
	t.Fatal("duplicate binding did not reach the rename oracle")
}

// Stock TypeScript 5.9.3 renames only one colliding binding in these native
// controls and removes TS2451. Schema's type/value pair follows that behavior.
func TestConsistencyRenameCollision(t *testing.T) {
	TestConsistencyRenameCollisionQuoted(t)
	w := NewWorkspace(t)
	for _, key := range consistencyCollisionKeys {
		for _, variant := range []uint8{0, 9} {
			t.Run(fmt.Sprintf("%s/%d", key, variant), func(t *testing.T) {
				checkConsistencyRenameCollision(t, w, key, variant)
			})
		}
	}
}

func FuzzEditorRenameCollisionDiagnostics(f *testing.F) {
	startShortBudget(f)
	for _, key := range consistencyCollisionKeys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(9))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestConsistencyRenameCollisionQuoted(t)
		if !slices.Contains(consistencyCollisionKeys, key) {
			if key == "" {
				return
			}
			key = consistencyCollisionKeys[int(key[0])%len(consistencyCollisionKeys)]
		}
		checkConsistencyRenameCollision(t, w, key, variant)
	})
}

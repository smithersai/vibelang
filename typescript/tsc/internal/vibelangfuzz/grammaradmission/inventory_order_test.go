package grammaradmission

import (
	"path/filepath"
	"strings"
	"testing"
)

// Alias rows account for additional branches of a hook. Their position in the
// inventory must not turn the distinct base row into a duplicate.
func TestCheckAliasBeforeBase(t *testing.T) {
	checkInventoryOrder(t, []byte{0})
}

func FuzzInventoryRowOrder(f *testing.F) {
	f.Add([]byte{0, 1, 2, 3})
	f.Add([]byte{1, 0, 3, 2})
	f.Add([]byte{3, 2, 1, 0})
	f.Fuzz(func(t *testing.T, order []byte) {
		checkInventoryOrder(t, order)
	})
}

func checkInventoryOrder(t *testing.T, order []byte) {
	t.Helper()
	rows := []string{
		"parser/vibelang_a.go:Parser.a\tadmission:a\t-\tpending\tr\n",
		"parser/vibelang_a.go:Parser.a@legacy\tadmission:legacy-a\t-\tpending\tr\n",
		"vibelang/b.go:lowering.b\tadmission:b\t-\tpending\tr\n",
		"vibelang/b.go:lowering.b@legacy\tadmission:legacy-b\t-\tpending\tr\n",
	}
	for i := len(rows) - 1; i > 0 && len(order) > 0; i-- {
		j := int(order[(len(rows)-1-i)%len(order)]) % (i + 1)
		rows[i], rows[j] = rows[j], rows[i]
	}
	hooks := map[string]bool{"parser/vibelang_a.go:Parser.a": true, "vibelang/b.go:lowering.b": true}
	specPath := func(chapter string) string { return filepath.Join(t.TempDir(), chapter) }
	data := strings.Join(rows, "")
	errs, stale := Check(hooks, data, specPath)
	if len(errs) != 0 || len(stale) != 0 {
		t.Fatalf("distinct rows in any order must account for both hooks: errors=%q stale=%q\n%s", errs, stale, data)
	}
	// Each base and each alias still needs independent duplicate detection.
	for _, row := range rows {
		errs, _ := Check(hooks, data+row, specPath)
		if len(errs) != 1 || !strings.HasPrefix(errs[0], "duplicate hook ") {
			t.Fatalf("one repeated base or alias row must fail once: %q\n%s", errs, row)
		}
	}
}

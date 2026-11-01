package vibelang

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// categoryAhead holds the registry codes whose default category disagrees with
// Appendix B, each with the lane or finding that settles it. Delete an entry
// when the two agree; the test fails until you do.
var categoryAhead = map[int32]string{}

// TestRegistryCategoriesMatchAppendixB checks each registry message's default
// category against its Appendix B row: a row that begins "warning" or "lint
// warning" is a warning, every other row an error. FuzzCompile checks the same
// rule on compiled programs, but only after a change lands; this test runs in
// //:spec-tests before it does, so a category edit on one side alone fails
// there (main RED on EK4609 2026-10-31 20:54Z, 2026-11-01 14:10Z and 14:42Z).
// Imported lint (EK38xx) keeps its own table and is not checked here.
func TestRegistryCategoriesMatchAppendixB(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile("../../../../docs/design/src/900-appendices.md")
	if err != nil {
		t.Fatal(err)
	}
	_, appendix, ok := strings.Cut(string(data), "## Appendix B. Diagnostics\n")
	if !ok {
		t.Fatal("the specification has no Appendix B. Diagnostics")
	}
	appendix, _, _ = strings.Cut(appendix, "\n## ")
	checked := 0
	seen := map[int32]bool{}
	for _, row := range regexp.MustCompile("(?m)^\\| `?EK([0-9]{4})`? \\| (.*)").FindAllStringSubmatch(appendix, -1) {
		if strings.HasPrefix(row[1], "38") {
			continue
		}
		number, _ := strconv.Atoi(row[1])
		code := int32(number)
		m := registry[code]
		if m == nil {
			continue
		}
		seen[code] = true
		rule := strings.ToLower(row[2])
		want := diagnostics.CategoryError
		if strings.HasPrefix(rule, "warning") || strings.HasPrefix(rule, "lint warning") {
			want = diagnostics.CategoryWarning
		}
		checked++
		lane, ahead := categoryAhead[code]
		switch {
		case m.Category != want && !ahead:
			t.Errorf("EK%04d is %s in the registry, but Appendix B makes it %s: %q", code, m.Category.Name(), want.Name(), row[2])
		case m.Category == want && ahead:
			t.Errorf("EK%04d's registry category now matches Appendix B; delete it from categoryAhead (%s)", code, lane)
		}
	}
	for code, lane := range categoryAhead {
		if !seen[code] {
			t.Errorf("categoryAhead holds EK%04d, which no Appendix B row gives the registry; delete it (%s)", code, lane)
		}
	}
	if checked == 0 {
		t.Fatal("no Appendix B row matched a registry code")
	}
	t.Logf("%d registry codes checked against Appendix B; %d pending", checked, len(categoryAhead))
}

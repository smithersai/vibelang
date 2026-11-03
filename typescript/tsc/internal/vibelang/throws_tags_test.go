package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// vibelang --fix removes every @throws and @rethrows tag that EK0406 reports
// in a .vibe file and turns throws-tag-effectful.fail into its fixed twin: a
// whole JSDoc comment that holds only such tags, a tag's own line in a longer
// comment, an indented method's or type member's comment line, and the
// plain function's and mixed union's tags. The TypeScript file's tags stay.
func TestVibeThrowsTagFix(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	result := fixCase(t, copyCompilerFixture(t, filepath.Join(cases, "throws-tag-effectful.fail"), root))
	if len(result.Refused) != 0 {
		t.Fatalf("refused %+v", result.Refused)
	}
	want, err := os.ReadFile(filepath.Join(cases, "throws-tag-effectful-fixed", "main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	got := ""
	for name, fixed := range result.Files {
		switch filepath.Base(name.AsString()) {
		case "main.vibe":
			got = fixed.Text
		case "helpers.ts":
			t.Errorf("--fix edited helpers.ts, whose tags are ignored:\n%s", fixed.Text)
		}
	}
	// The first line is each case's harness header: expect, then expect-result.
	body := func(text string) string { return text[strings.IndexByte(text, '\n')+1:] }
	if body(got) != body(string(want)) {
		t.Errorf("--fix writes\n%s\nwant\n%s", got, want)
	}
}

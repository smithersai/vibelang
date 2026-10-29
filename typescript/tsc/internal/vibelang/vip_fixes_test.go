package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Each VIP codemod's case: vibelang --fix writes the -fixed twin for the
// .fail case, apart from the expectation line, and the twin's
// expect-result is what the original program gave before the VIP.
func TestVIPCodemodCases(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	for _, name := range []string{"producer-return-value"} {
		t.Run(name, func(t *testing.T) {
			result := fixCase(t, copyCompilerFixture(t, filepath.Join(cases, name+".fail"), root))
			if len(result.Refused) != 0 || len(result.Files) != 1 {
				t.Fatalf("fix: %+v", result)
			}
			var got string
			for _, fixed := range result.Files {
				got = fixed.Text
			}
			want, err := os.ReadFile(filepath.Join(cases, name+"-fixed/main.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			body := func(text string) string {
				_, rest, _ := strings.Cut(text, "\n")
				return rest
			}
			if body(got) != body(string(want)) {
				t.Fatalf("--fix writes\n%s\nwant\n%s", got, want)
			}
		})
	}
}

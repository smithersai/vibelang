package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoaderScriptProjectQuoted(t *testing.T) {
	const quote = "**Existing tools work.**"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
	readme, err := os.ReadFile(filepath.Join(Root(), "packages/compiler/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	const readmeQuote = "Set `VIBELANG_PROJECT` to a tsconfig path to\nchoose another project, such as `tsconfig.test.json` for an example beside a\nlibrary; it compiles the modules in its directory, and a module of another\nworkspace package, such as a dependency linked to its source, still compiles\nwith that package's own `tsconfig.json`."
	if !strings.Contains(string(readme), readmeQuote) {
		t.Fatalf("loader project-selection contract changed: %q", readmeQuote)
	}
	property, err := os.ReadFile(filepath.Join(Root(), "packages/compiler/test/loader-script-project.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(readmeQuote, "\n") {
		if !strings.Contains(string(property), line) {
			t.Fatalf("property must retain the guarded contract: %q", line)
		}
	}
}

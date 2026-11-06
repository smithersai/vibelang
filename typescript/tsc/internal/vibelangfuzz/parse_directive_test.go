package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

const parseDirectiveQuote = "With the directive, `.ts`, `.mts` and `.cts` are `.vibe`, and `.tsx` is `.vibex`."

func TestParseDirectiveQuoted(t *testing.T) {
	paths, err := filepath.Glob(SpecPath("../vips/0042-*.md"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("VIP-42: %v, %v", paths, err)
	}
	text, err := os.ReadFile(paths[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), parseDirectiveQuote) {
		t.Fatal(parseDirectiveQuote)
	}
}

// The tree of a directive source overlaps as a .vibe file's does, so it answers
// to the span oracle. Each witness first shows that overlap, so this cannot pass
// on a source the sibling oracle would have accepted anyway.
func TestParseDirectiveSourcesUseVibeLangSpans(t *testing.T) {
	TestParseDirectiveQuoted(t)
	const body = "export service Named { name(): string!! }\n"
	ts := parseKind{"/fuzz/main.ts", core.ScriptKindTS}
	for name, source := range map[string]string{
		"plain":   "// @vibe\n" + body,
		"bom":     "\xef\xbb\xbf// @vibe\n" + body,
		"shebang": "#!/usr/bin/env node\n// @vibe\n" + body,
		"crlf":    "// @vibe  \r\n" + body,
	} {
		t.Run(name, func(t *testing.T) {
			file := parseAs(ts, source)
			if !file.IsVibeLang() {
				t.Fatalf("%q does not read as VibeLang", source)
			}
			if treeProblem(file, source) == "" {
				t.Fatalf("no overlapping tree in %q, so this witnesses nothing", source)
			}
			g := &Gaps{Target: "FuzzParse", Input: name}
			parseGaps(g, source)
			if g.Any() {
				t.Fatalf("%+v", g.found)
			}
		})
	}
	// What keeps its TypeScript reading keeps the sibling oracle.
	for name, file := range map[string]parseKind{
		"lookalike":   ts,
		"declaration": {"/fuzz/main.d.ts", core.ScriptKindTS},
	} {
		source := "// @vibe\n" + body
		if name == "lookalike" {
			source = "// @vibes\n" + body
		}
		if parseAs(file, source).IsVibeLang() {
			t.Errorf("%s reads as VibeLang", name)
		}
	}
}

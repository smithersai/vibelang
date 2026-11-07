package vibelang

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// ownConfigWarnings are the table's configuration warnings, each with a
// tsconfig.json that reports it. They are config-file diagnostics, outside
// the source message registry.
var ownConfigWarnings = map[string]string{
	"EK3009": `{"vibelang":{"diagnostics":{"EK4802":"error"}},"files":["main.ts"]}`,
	"EK3010": `{"vibe":{"trustedPackages":["left-pad"]},"files":["main.ts"]}`,
	"EK3011": `{"vibelang":{"declarationImportStyle":".js"},"files":["main.ts"]}`,
	"EK3012": `{"vibe":{"severities":{"EK3801":"warning"}},"files":["main.ts"]}`,
}

// configWarning parses config and returns the category of its diagnostics
// with code, and how many it reported.
func configWarning(t *testing.T, config string, code int32) (diagnostics.Category, int) {
	t.Helper()
	files := map[string]string{"/p/tsconfig.json": config, "/p/main.ts": "export const n = 1\n"}
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/tsconfig.json"), &core.CompilerOptions{}, nil, vfstest.FromMap(files, tspath.CaseSensitive), nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	var category diagnostics.Category
	n := 0
	for _, d := range parsed.GetConfigFileParsingDiagnostics() {
		if d.Code() == code {
			category = d.Category()
			n++
		}
	}
	return category, n
}

// rule-evidence: docs/design/src/007-tooling.md#vibelang-warnings | The following own warnings default to `"warning"`; they are separate from imported rules and the [TypeScript-form advisories](#typescript-spellings-with-vibelang-forms).
//
// TestOwnWarningsDefaultToWarning reads the VibeLang warnings table of
// Chapter 7 and checks each code: its registered message is a warning that is
// on without configuration, it is not an imported Effect lint code, and it is
// not one of the TypeScript-form advisories.
func TestOwnWarningsDefaultToWarning(t *testing.T) {
	t.Parallel()
	spec, err := os.ReadFile("../../../../docs/design/src/007-tooling.md")
	if err != nil {
		t.Fatal(err)
	}
	text := string(spec)
	section := func(heading string) string {
		start := strings.Index(text, heading+"\n")
		if start < 0 {
			t.Fatalf("Chapter 7 has no %q", heading)
		}
		rest := text[start+len(heading):]
		level := heading[:strings.Index(heading, " ")+1]
		if end := regexp.MustCompile("(?m)^#{2," + fmt.Sprint(len(level)-1) + "} ").FindStringIndex(rest); end != nil {
			rest = rest[:end[0]]
		}
		return rest
	}
	rowCodes := func(body string) []string {
		var codes []string
		for _, m := range regexp.MustCompile("(?m)^\\| .*? \\| `(EK[0-9]{4})` \\|").FindAllStringSubmatch(body, -1) {
			codes = append(codes, m[1])
		}
		return codes
	}
	firstColumn := func(body string) map[string]bool {
		codes := map[string]bool{}
		for _, m := range regexp.MustCompile("(?m)^\\| `(EK[0-9]{4,})` \\|").FindAllStringSubmatch(body, -1) {
			codes[m[1]] = true
		}
		return codes
	}
	warnings := rowCodes(section("### VibeLang warnings"))
	if len(warnings) < 10 {
		t.Fatalf("the VibeLang warnings table lists %d codes: %v", len(warnings), warnings)
	}
	advisories := firstColumn(section("## TypeScript spellings with VibeLang forms"))
	if len(advisories) < 8 {
		t.Fatalf("the TypeScript-form table lists %d codes", len(advisories))
	}
	for _, code := range warnings {
		var n int32
		fmt.Sscanf(code, "EK%d", &n)
		if config, ok := ownConfigWarnings[code]; ok {
			if got, count := configWarning(t, config, n); count != 1 || got != diagnostics.CategoryWarning {
				t.Errorf("%s: %d config diagnostics, category %v; want one warning", code, count, got)
			}
		} else if m := registry[n]; m == nil {
			t.Errorf("%s has no registered message", code)
		} else {
			if got, on := category(nil, m); got != diagnostics.CategoryWarning || !on {
				t.Errorf("%s defaults to %v (on %v), want a warning", code, got, on)
			}
			if got, on := category(&core.CompilerOptions{}, m); got != diagnostics.CategoryWarning || !on {
				t.Errorf("%s defaults to %v (on %v) under empty options, want a warning", code, got, on)
			}
		}
		if _, imported := core.VibeImportedLintCodes[code]; imported {
			t.Errorf("%s is an imported Effect lint code", code)
		}
		if advisories[code] {
			t.Errorf("%s is also a TypeScript-form advisory", code)
		}
	}
}

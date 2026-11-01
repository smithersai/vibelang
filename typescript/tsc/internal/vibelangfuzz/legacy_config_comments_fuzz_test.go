package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const legacyCommentsQuote = "`vibelang --fix` moves each eligible map to root `vibe.severities`, including in extended configs, preserving JSONC comments, unrelated settings and existing modern entries."
const legacyCommentsStableQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."

func legacyCommentsQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{legacyCommentsQuote, legacyCommentsStableQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 7 no longer says %q", quote)
		}
	}
}
func TestLegacyConfigCommentsQuoted(t *testing.T) { legacyCommentsQuoted(t) }

// Generate eligible root/compilerOptions maps, empty maps, modern overrides,
// retained wrappers, duplicate entries and trailing commas. The scanner inserts
// a uniquely identified comment at EVERY token boundary, including the EOF
// boundary. Bytes mutate comment styles and line endings without changing
// settings; the independent expected config implements Chapter 7's precedence.
func FuzzLegacyConfigComments(f *testing.F) {
	startShortBudget(f)
	legacyCommentsQuoted(f)
	keys := []string{"root", "nested", "both", "root-empty", "nested-empty", "root-retained", "nested-retained"}
	for _, key := range keys {
		for _, data := range [][]byte{{0}, {1}, {2}, {3}, {4}, {8}, {16}, {24}, {255}, {0, 1, 2, 3, 4, 5, 6, 7}} {
			f.Add(key, data)
		}
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		if len(data) > 256 {
			data = data[:256]
		}
		choice := func(i int) byte {
			if len(data) == 0 {
				return 0
			}
			return data[i%len(data)]
		}
		selected := int(choice(0)) % len(keys)
		for i, k := range keys {
			if key == k {
				selected = i
			}
		}
		key = keys[selected]
		nested := strings.HasPrefix(key, "nested")
		empty := strings.HasSuffix(key, "empty")
		retained := strings.HasSuffix(key, "retained")
		levels := []string{"off", "warning", "error"}
		severity := levels[int(choice(1))%len(levels)]
		mode := (choice(8) >> 3) % 4
		modern := mode == 0 && choice(2)&1 != 0
		duplicates := choice(3)&1 != 0
		trailing := choice(4)&1 != 0
		entries := `"EK4830":"` + severity + `","EK4831":"warning"`
		want := map[string]string{"EK4830": severity, "EK4831": "warning"}
		if duplicates {
			entries = `"EK4830":"error",` + entries
		}
		if empty {
			entries = ""
			want = map[string]string{}
		}
		if trailing && !empty {
			entries += ","
		}
		legacy := `{"diagnostics":{` + entries + `}`
		expectedLegacy := ""
		if retained {
			extra := `,"tracing":"all","trustedPackages":["https://example.invalid/*string*/"]`
			legacy += extra
			expectedLegacy = `,"vibelang":{` + strings.TrimPrefix(extra, ",") + `}`
		}
		legacy += "}"
		modernEntries := `"EK4833":"off"`
		if mode == 0 {
			want["EK4833"] = "off"
		}
		if modern {
			modernEntries += `,"EK4830":"off"`
			want["EK4830"] = "off"
		}
		legacyProperty := `"vibelang":` + legacy
		if key == "both" {
			legacyProperty = `"vibelang":` + legacy + `,"compilerOptions":{"vibelang":` + legacy + `,"strict":true}`
		} else if nested {
			legacyProperty = `"compilerOptions":{` + legacyProperty + `,"strict":true}`
		} else {
			legacyProperty += `,"compilerOptions":{"strict":true}`
		}
		vibeSection := `,"vibe":{"effectModules":false`
		switch mode {
		case 0:
			vibeSection += `,"severities":{` + modernEntries + `}}`
		case 1:
			vibeSection += `,"severities":{}}`
		case 2:
			vibeSection += `}`
		case 3:
			vibeSection = ""
		}
		source := `{` + legacyProperty + vibeSection + `,"files":["main.vibe"]}`
		var comments []string
		var marked strings.Builder
		scan := scanner.NewScanner()
		scan.SetText(source)
		for i := 0; ; i++ {
			kind := scan.Scan()
			marker := fmt.Sprintf("KEEP_%d_😀 { }", i)
			comment := "/* " + marker + " // quote \" */"
			switch choice(i+5) % 5 {
			case 1:
				comment = "// " + marker + " /* block"
			case 2:
				comment = "/*\n " + marker + "\n */"
			}
			comments = append(comments, comment)
			ending := []string{"\n", "\r\n", "\r", "\u2028", "\u2029"}[int(choice(i+6))%5]
			marked.WriteString(" " + comment + ending)
			if kind == ast.KindEndOfFile {
				break
			}
			marked.WriteString(scan.TokenText())
		}
		source = marked.String()
		fixed, changed := tsoptions.MigrateLegacySeverities("/project/base.json", source)
		fail := func(part, format string, args ...any) {
			t.Helper()
			Gap(t, "FuzzLegacyConfigComments", key+":"+part, format, args...)
		}
		if !changed {
			fail("migration", "did not migrate:\n%s", source)
		}
		for _, comment := range comments {
			if strings.Count(fixed, comment) != 1 {
				fail("comment", "lost or duplicated %q:\n%s", comment, fixed)
			}
		}
		if again, changed := tsoptions.MigrateLegacySeverities("/project/base.json", fixed); changed || again != fixed {
			fail("stable", "second migration differs:\n%s", again)
		}
		encoded, err := json.Marshal(want)
		if err != nil {
			t.Fatal(err)
		}
		expectedVibe := vibeSection
		if len(want) > 0 {
			flags := `"effectModules":false,`
			if mode == 3 {
				flags = ""
			}
			expectedVibe = `,"vibe":{` + flags + `"severities":` + string(encoded) + `}`
		}
		expected := `{"compilerOptions":{"strict":true}` + expectedVibe + expectedLegacy + `,"files":["main.vibe"]}`
		for _, inherited := range []bool{false, true} {
			parse := func(text string) *tsoptions.ParsedCommandLine {
				root, base := text, "{}"
				if inherited {
					root, base = `{"extends":"./base.json","files":["main.vibe"]}`, text
				}
				fs := vfstest.FromMap(map[string]string{"/project/tsconfig.json": root, "/project/base.json": base, "/project/main.vibe": "export const value=1"}, tspath.CaseSensitive)
				parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
				if len(errors) != 0 || parsed == nil {
					t.Fatalf("read config: %v", errors)
				}
				if len(parsed.Errors) != 0 {
					fail("jsonc", "invalid migrated config: %v\n%s", parsed.Errors, text)
				}
				return parsed
			}
			got, wanted := parse(fixed).CompilerOptions(), parse(expected).CompilerOptions()
			if !got.VibeLang.Equals(wanted.VibeLang) || got.Strict != wanted.Strict {
				fail("options", "extends=%v: options changed: got %+v, want %+v\n%s", inherited, got.VibeLang, wanted.VibeLang, fixed)
			}
		}
	})
}

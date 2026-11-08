// Chapter 007 / legacy severity maps: inheritance and whole-section replacement.
package vibelangfuzz

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const legacySectionInheritQuote = "a child without a legacy section inherits the effective base section, and adding only modern settings leaves it active."
const legacySectionReplaceQuote = "An explicit child legacy section replaces the inherited legacy section as a whole, rather than merging diagnostic entries; even an empty object or `null` clears the inherited legacy settings."

func legacySectionQuoted(t testing.TB) {
	t.Helper()
	chapter := SpecText("007-tooling.md")
	for _, quote := range []string{legacySectionInheritQuote, legacySectionReplaceQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("chapter 7 no longer says %q", quote)
		}
	}
}
func TestLegacySectionReplacementQuoted(t *testing.T) { legacySectionQuoted(t) }

// A base config holds a legacy map in one of its two placements; the child
// inherits it, adds only modern settings, or writes its own legacy section
// with entries, as `{}` or as `null`. The independent expected map follows
// the two quoted sentences; the child's section wins whole or not at all.
func FuzzLegacySectionReplacement(f *testing.F) {
	startShortBudget(f)
	legacySectionQuoted(f)
	keys := []string{"inherit", "modern-only", "replace-entries", "replace-empty", "replace-null"}
	for _, key := range keys {
		for _, data := range [][]byte{{0}, {1, 2, 3}, {255, 254, 253}} {
			f.Add(key, data)
		}
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		pick := func(i, n int) int {
			if len(data) == 0 {
				return 0
			}
			return int(data[i%len(data)]) % n
		}
		selected := pick(0, len(keys))
		for i, candidate := range keys {
			if key == candidate {
				selected = i
			}
		}
		key = keys[selected]
		levels := []string{"off", "warning", "error"}
		baseCode, childCode := "EK4801", "EK4830"
		if pick(1, 2) == 1 {
			baseCode, childCode = "EK4830", "EK4823"
		}
		baseLevel, childLevel := levels[pick(2, 3)], levels[pick(3, 3)]
		baseNested, childNested := pick(4, 2) == 1, pick(5, 2) == 1
		name := []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"}[pick(6, 3)]
		section := func(nested bool, legacy string) string {
			if nested {
				return `"compilerOptions":{"strict":true,"vibelang":` + legacy + `}`
			}
			return `"compilerOptions":{"strict":true},"vibelang":` + legacy
		}
		base := "{" + section(baseNested, fmt.Sprintf(`{"diagnostics":{%q:%q}}`, baseCode, baseLevel)) + "}"
		child := `"extends":"./base.json"`
		want := map[string]string{baseCode: baseLevel}
		switch key {
		case "modern-only":
			child += `,"vibe":{"severities":{"EK4609":"off"}}`
		case "replace-entries":
			child += "," + section(childNested, fmt.Sprintf(`{"diagnostics":{%q:%q}}`, childCode, childLevel))
			want = map[string]string{childCode: childLevel}
		case "replace-empty":
			child += "," + section(childNested, `{"diagnostics":{}}`)
			want = map[string]string{}
		case "replace-null":
			child += "," + section(childNested, `{"diagnostics":null}`)
			want = map[string]string{}
		}
		fs := vfstest.FromMap(map[string]string{
			"/p/base.json": base,
			"/p/" + name:   "{" + child + `,"files":["main.vibe"]}`,
			"/p/main.vibe": "export const n = 1",
		}, tspath.CaseSensitive)
		config, readErrors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, fs, nil)
		if len(readErrors) != 0 {
			t.Fatal(readErrors)
		}
		for _, d := range config.Errors {
			if d.Source() != "EK" {
				Gap(t, "FuzzLegacySectionReplacement", key+":accepted", "chapter 7: %s; the child legacy section was rejected: %v\nbase=%s\nchild=%s", legacySectionReplaceQuote, d, base, child)
				return
			}
		}
		got := map[string]string{}
		if options := config.CompilerOptions().VibeLang; options != nil && options.Diagnostics != nil {
			got = options.Diagnostics
		}
		if !reflect.DeepEqual(got, want) {
			Gap(t, "FuzzLegacySectionReplacement", key+":effective", "chapter 7: %s %s; effective legacy map: got %v, want %v\nbase=%s\nchild=%s", legacySectionInheritQuote, legacySectionReplaceQuote, got, want, base, child)
			return
		}
		ExpectPending(t, "FuzzLegacySectionReplacement", key+":accepted")
		ExpectPending(t, "FuzzLegacySectionReplacement", key+":effective")
	})
}

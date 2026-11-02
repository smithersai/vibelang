package vibelangfuzz

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const severityInheritanceQuote = "After `extends` merges entries by code, validate each effective entry independently."
const severityInheritanceInvalidQuote = "An invalid child entry has already displaced the same code's inherited setting and does not restore that base entry"

func severityInheritanceQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{severityInheritanceQuote, severityInheritanceInvalidQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 7 no longer says %q", quote)
		}
	}
}

func TestSeverityInheritanceQuoted(t *testing.T) { severityInheritanceQuoted(t) }

// Static VIP-30 oracle: construct independently known effective entries from
// child, array, chain and diamond precedence. Invalid entries displaced by a
// valid winner must not fail the selected project. Keep invalid winners,
// independent entries and their file/value spans visible.
func FuzzSeverityInheritance(f *testing.F) {
	startShortBudget(f)
	severityInheritanceQuoted(f)
	keys := []string{"child", "later-base", "inherited", "invalid-child", "independent", "diamond", "cached-sibling", "invalid-later"}
	for _, key := range keys {
		for _, data := range [][]byte{{0}, {1, 2, 3, 4}, {255, 254, 253, 252}} {
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
				break
			}
		}
		key = keys[selected]
		code := []string{"EK4609", "EK0801", "EK3801", "EK38100"}[pick(1, 4)]
		bad := []string{`"bad"`, `42`, `null`, `true`, `[]`, `{}`, `""`}[pick(2, 7)]
		valid := []string{"off", "warning", "suggestion", "error"}[pick(3, 4)]
		name := []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"}[pick(4, 3)]
		entries := func(value string) string { return fmt.Sprintf(`{"vibe":{"severities":{%q:%s}}}`, code, value) }
		base := entries(bad)
		later := entries(fmt.Sprintf("%q", valid))
		child := fmt.Sprintf(`"extends":"./base.json","vibe":{"severities":{%q:%q}}`, code, valid)
		want := map[string]string{code: valid}
		wantErrors := 0
		wantFile := "/p/base.json"
		switch key {
		case "later-base":
			child = `"extends":["./base.json","./later.json"]`
		case "inherited":
			child, want, wantErrors = `"extends":"./base.json"`, map[string]string{}, 1
		case "invalid-child":
			base = later
			child = fmt.Sprintf(`"extends":"./base.json","vibe":{"severities":{%q:%s}}`, code, bad)
			want, wantErrors, wantFile = map[string]string{}, 1, "/p/"+name
		case "independent":
			base = fmt.Sprintf(`{"vibe":{"severities":{%q:%s,"EK4830":%s}}}`, code, bad, bad)
			wantErrors = 1
		case "diamond":
			later = fmt.Sprintf(`{"extends":"./base.json","vibe":{"severities":{%q:%q}}}`, code, valid)
			child = `"extends":["./base.json","./later.json"]`
		case "cached-sibling":
			// The second branch must retain the cached invalid base. Its valid sibling
			// must not remove the cached diagnostic while merging its own override.
			later = fmt.Sprintf(`{"extends":"./base.json","vibe":{"severities":{%q:%q}}}`, code, valid)
			child = `"extends":["./later.json","./base.json"]`
			want, wantErrors = map[string]string{}, 1
		case "invalid-later":
			later = entries(bad)
			child = `"extends":["./base.json","./later.json"]`
			want, wantErrors, wantFile = map[string]string{}, 1, "/p/later.json"
		}
		fs := vfstest.FromMap(map[string]string{
			"/p/base.json": base, "/p/later.json": later,
			"/p/" + name:   "{" + child + `,"files":["main.vibe"]}`,
			"/p/main.vibe": "export const n = 1",
		}, tspath.CaseSensitive)
		config, readErrors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, fs, nil)
		if len(readErrors) != 0 {
			t.Fatal(readErrors)
		}
		if len(config.Errors) != wantErrors {
			Gap(t, "FuzzSeverityInheritance", key+":diagnostics", "VIP-30 effective entries want %d errors; got %v; base=%s child=%s", wantErrors, config.Errors, base, child)
			return
		}
		if wantErrors > 0 {
			d := config.Errors[0]
			if d.Source() != "EK" || d.Code() != 3006 || d.File() == nil || d.File().FileName().AsString() != wantFile || d.File().Text()[d.Pos():d.End()] != bad {
				Gap(t, "FuzzSeverityInheritance", key+":origin", "wrong winning diagnostic: %v, want EK3006 at %s value %s", d, wantFile, bad)
			}
		}
		got := config.CompilerOptions().VibeLang.Severities
		if len(got) != len(want) || (len(want) != 0 && !reflect.DeepEqual(got, want)) {
			Gap(t, "FuzzSeverityInheritance", key+":settings", "VIP-30 effective settings: got %v, want %v", got, want)
		}
	})
}

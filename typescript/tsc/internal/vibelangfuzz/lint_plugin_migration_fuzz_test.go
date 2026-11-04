package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
)

const lintPluginMigrationQuote = "With the entry present, migration is idempotent and reports no `EK3012`."

func TestLintPluginMigrationQuoted(t *testing.T) {
	quote := lintPluginMigrationQuote
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("missing VIP-38 migration oracle %q", quote)
	}
}
func FuzzLintPluginMigration(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"local", "inherited", "empty", "root", "trailing-comma"} {
		f.Add(key, "retained", true)
	}
	f.Fuzz(func(t *testing.T, key, value string, lineComment bool) {
		if len(value) > 64 {
			value = value[:64]
		}
		value = strings.ToValidUTF8(value, "\uFFFD")
		if len(key) > 64 {
			key = key[:64]
		}
		if key != "local" && key != "inherited" && key != "empty" && key != "root" && key != "trailing-comma" {
			key = "local"
		}
		payload, _ := json.Marshal(value)
		comment := "/* preserve comment */"
		if lineComment {
			comment = "// preserve comment\n"
		}
		entry := `{"name":"other","options":{"marker":` + string(payload) + `}}`
		source := fmt.Sprintf("{%s\"compilerOptions\":{\"plugins\":[%s]},\"files\":[\"main.ts\"]}", comment, entry)
		var inherited []any
		switch key {
		case "inherited":
			source = "{" + comment + `"compilerOptions":{"strict":true},"files":["main.ts"]}`
			inherited = []any{map[string]any{"name": "other", "options": map[string]any{"marker": value}}}
		case "empty":
			source = "{" + comment + `"compilerOptions":{"plugins":[]},"files":["main.ts"]}`
		case "root":
			source = "{" + comment + `"files":["main.ts"]}`
		case "trailing-comma":
			source = "{" + comment + `"compilerOptions":{"plugins":[` + entry + ",/* trailing */]},\"files\":[\"main.ts\"]}"
		}
		fixed, changed := tsoptions.MigrateLintPlugin("/migration/tsconfig.json", source, inherited)
		if !changed || !strings.Contains(fixed, comment) {
			Gap(t, "FuzzLintPluginMigration", key, "VIP-38 lost migration or comment: %s", fixed)
		}
		parsed, errors := tsoptions.ParseConfigFileTextToJson("/migration/tsconfig.json", "/migration/tsconfig.json", fixed)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		root := parsed.(*collections.OrderedMap[string, any])
		options := root.GetOrZero("compilerOptions").(*collections.OrderedMap[string, any])
		plugins := options.GetOrZero("plugins").([]any)
		count := 0
		other := 0
		for _, item := range plugins {
			plugin := item.(*collections.OrderedMap[string, any])
			if plugin.GetOrZero("name") == "@effect/language-service" {
				count++
				if plugin.Size() != 1 {
					t.Fatal("added non-default Effect options")
				}
			}
			if plugin.GetOrZero("name") == "other" {
				other++
				opts := plugin.GetOrZero("options").(*collections.OrderedMap[string, any])
				if opts.GetOrZero("marker") != value {
					t.Fatal("changed plugin options")
				}
			}
		}
		wantOther := 0
		if key == "local" || key == "inherited" || key == "trailing-comma" {
			wantOther = 1
		}
		if count != 1 || other != wantOther {
			Gap(t, "FuzzLintPluginMigration", key, "VIP-38 plugin counts effect=%d other=%d", count, other)
		}
		again, changed := tsoptions.MigrateLintPlugin("/migration/tsconfig.json", fixed, nil)
		if changed || again != fixed {
			Gap(t, "FuzzLintPluginMigration", key, "VIP-38 migration is not idempotent")
		}
	})
}

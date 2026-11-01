package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions/tsoptionstest"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const interimSeverityQuote = "an interim `EK92xx` code, even one printed as a warning"

func TestInterimSeverityRulesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), interimSeverityQuote) {
		t.Fatal(interimSeverityQuote)
	}
}
func FuzzInterimSeverityRules(f *testing.F) {
	startShortBudget(f)
	for n := uint8(0); n < 8; n++ {
		f.Add("config:severity-interim-rejected", n, n, n)
	}
	if !strings.Contains(SpecText("007-tooling.md"), interimSeverityQuote) {
		f.Fatal(interimSeverityQuote)
	}
	f.Fuzz(func(t *testing.T, key string, code, value, placement uint8) {
		values := []any{"error", "warning", "suggestion", "off", 1, nil, []any{}, map[string]any{}}
		bad := fmt.Sprintf("EK%d", 9201+int(code%8))
		settings := map[string]any{"vibe": map[string]any{"severities": map[string]any{bad: values[int(value)%len(values)], "EK0801": "off"}}}
		config := settings
		files := map[string]any{"/project/main.ts": "export {}"}
		switch placement % 3 {
		case 1:
			files["/project/base.json"] = settings
			config = map[string]any{"extends": "./base.json"}
		case 2:
			files["/project/base.json"] = map[string]any{"vibe": map[string]any{"severities": map[string]any{bad: "off", "EK0508": "off"}}}
			settings["extends"] = []any{"./base.json"}
		}
		config["files"] = []any{"main.ts"}
		files["/project/tsconfig.json"] = config
		texts := map[string]string{}
		for name, value := range files {
			if s, ok := value.(string); ok {
				texts[name] = s
			} else {
				data, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				texts[name] = string(data)
			}
		}
		fs := tsoptionstest.NewVFS(texts, tspath.CaseSensitive)
		parsed := tsoptions.ParseJsonConfigFileContent(config, fs, "/project", nil, "/project/tsconfig.json", nil, nil)
		count := 0
		for _, d := range parsed.Errors {
			if d.Source() == "EK" && d.Code() == 3006 {
				count++
			} else {
				t.Errorf("unexpected diagnostic: %v", d)
			}
		}
		want := 1
		if placement%3 == 2 {
			want = 2
		} // each invalid written entry is reported, even if overridden
		if count != want {
			Gap(t, "FuzzInterimSeverityRules", "config:severity-interim-rejected", "%s %s: want %d EK3006, got %v", key, bad, want, parsed.Errors)
		}
		if parsed.CompilerOptions().VibeLang.Severities["EK0801"] != "off" {
			t.Fatal("lost independent valid override")
		}
	})
}

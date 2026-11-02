package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const configSpanQuote = "An unknown `vibe` key or a value of the wrong type is a config error (`EK3007`), as for TypeScript’s `compilerOptions`"

func configSpansQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), configSpanQuote) {
		t.Fatal(configSpanQuote)
	}
}
func TestConfigDiagnosticSpansQuoted(t *testing.T) { configSpansQuoted(t) }

// VIP-30 config values retain TypeScript's last-key meaning. An EK diagnostic
// must point at the value it rejects, rather than an overwritten valid token.
// Native TS config counterpart: a repeated compilerOptions.target diagnoses
// the last invalid target, with no error at the earlier valid target.
func FuzzConfigDiagnosticSpans(f *testing.F) {
	startShortBudget(f)
	configSpansQuoted(f)
	keys := []string{"effectGlobals", "effectModules", "severities", "severity-entry"}
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
		for i, k := range keys {
			if key == k {
				selected = i
				break
			}
		}
		key = keys[selected]
		value := []string{`42`, `null`, `"invalid"`, `[]`}[pick(1, 4)]
		name := []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"}[pick(2, 3)]
		field := key
		valid := "true"
		code := int32(3007)
		if key == "severities" {
			valid = "{}"
		}
		if key == "severity-entry" {
			field, valid, code = "EK4609", `"off"`, 3006
		}
		var fields strings.Builder
		for i := 0; i <= pick(3, 5); i++ {
			fmt.Fprintf(&fields, `%q:%s,/* prior %d */`, field, valid, i)
		}
		fmt.Fprintf(&fields, `%q: /* winning */ %s`, field, value)
		settings := fields.String()
		if key == "severity-entry" {
			settings = `"severities":{` + settings + "}"
		}
		text := "{\n" + `"vibe":{` + settings + `},"files":["main.ts"]}`
		fs := vfstest.FromMap(map[string]string{"/p/" + name: text, "/p/main.ts": "export {}"}, tspath.CaseSensitive)
		config, readErrors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, fs, nil)
		if len(readErrors) != 0 {
			t.Fatal(readErrors)
		}
		if len(config.Errors) != 1 || config.Errors[0].Source() != "EK" || config.Errors[0].Code() != code {
			Gap(t, "FuzzConfigDiagnosticSpans", key+":diagnostic", "want one EK%d, got %v", code, config.Errors)
			return
		}
		d := config.Errors[0]
		if got := text[d.Pos():d.End()]; got != value {
			Gap(t, "FuzzConfigDiagnosticSpans", key+":span", "diagnostic labels overwritten %s instead of winning %s", got, value)
		}
	})
}

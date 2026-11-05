package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestOptionalForeignCallbacksQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", foreignVariableQuote, foreignVariableAdmissionQuote, foreignVariableAliasQuote)
}

// Config and Exit are data results; neither grants an unannotated foreign
// callback the never-throw contract of a fresh VibeLang function type.
func FuzzOptionalForeignCallbacks(f *testing.F) {
	startShortBudget(f)
	for _, shape := range []string{"scalar", "config", "exit"} {
		f.Add(shape, false, uint8(0))
		f.Add(shape, true, uint8(3))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, tagged bool, variation uint8) {
		TestOptionalForeignCallbacksQuoted(t)
		result, expression := "string", fmt.Sprintf("%q", "value")
		switch key {
		case "config":
			result, expression = "Config.Config<string>", fmt.Sprintf("Config.succeed(%q)", "value")
		case "exit":
			result, expression = "Exit.Exit<string>", fmt.Sprintf("Exit.succeed(%q)", "value")
		default:
			key = "scalar"
		}
		tag := ""
		if tagged {
			tag = "/** @throws {never} */\n"
		}
		helper := fmt.Sprintf("import { Config, Exit } from %q;\n%sexport const factory = (): %s => %s;\n", "effect", tag, result, expression)
		parameter, call := "() => "+result, "f()"
		if variation&1 != 0 {
			parameter, call = "(() => "+result+") | undefined", "f?.()"
		}
		value, alias := "factory", ""
		if variation&2 != 0 {
			value, alias = "copy", "const copy = factory;\n"
		}
		source := fmt.Sprintf("import { Config, Exit } from %q; import { factory } from %q;\n%sfunction accept(f: %s) { return %s }\nexport const value = accept(%s);\n",
			"effect", "./helpers.js", alias, parameter, call, value)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "helpers.ts": helper}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if !IsEK(d) || d.Code() != 402 {
				t.Fatalf("%s tagged=%t: unexpected diagnostic %s", key, tagged, d.String())
			}
			got++
		}
		want := 1
		if tagged {
			want = 0
		}
		if got != want {
			Gap(t, "FuzzOptionalForeignCallbacks", fmt.Sprintf("%s/tagged=%t/variation=%d", key, tagged, variation&3),
				"VIP-4: %s; %s; got %d EK0402, want %d\n%s", foreignVariableQuote, foreignVariableAdmissionQuote, got, want, source)
		}
	})
}

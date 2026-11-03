package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const schemaStructAdvisoryQuote = "| `EK4841` | A schema `const` immediately followed by its matching `typeof Name.Type` alias | Use the corresponding `schema Name = …` declaration where the schema mapping preserves both exports. |"

func requireSchemaStructAdvisoryQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), schemaStructAdvisoryQuote) {
		t.Fatalf("chapter 007 no longer contains %q", schemaStructAdvisoryQuote)
	}
}

func TestSchemaStructAdvisoryQuoted(t *testing.T) { requireSchemaStructAdvisoryQuote(t) }

// Static VIP-15/VIP-34 oracle: Struct is a schema, so eligible pairs receive
// EK4841 at the configured severity. Generate neighbouring field mappings,
// import forms, scopes, export flags, trivia and disqualifying pair layouts.
// The editor quick-fix regression separately exercises the actual edits.
func FuzzSchemaStructAdvisory(f *testing.F) {
	startShortBudget(f)
	requireSchemaStructAdvisoryQuote(f)
	w := NewWorkspace(f)
	for _, seed := range []struct {
		key  string
		mode uint16
	}{
		{"string", 1}, {"number", 2 | 4 | 8}, {"boolean", 16 | 32},
		{"string", 1 | 1024}, {"number", 1 | 2048}, {"boolean", 1 | 3072},
		{"string", 64}, {"string", 128}, {"string", 256}, {"string", 512},
	} {
		f.Add(seed.key, seed.mode)
	}
	f.Fuzz(func(t *testing.T, key string, mode uint16) {
		const target = "FuzzSchemaStructAdvisory"
		defer recoverCompilerPanic(t, target)
		primitive := map[string]string{"string": "String", "number": "Number", "boolean": "Boolean"}[key]
		if primitive == "" {
			key, primitive = "string", "String"
		}
		value := "Schema." + primitive
		if mode&32 != 0 {
			value = "Schema.Struct({ inner: " + value + " })"
		}
		if mode&8 != 0 {
			value = "Schema.optional(" + value + ")"
		}
		if mode&16 != 0 {
			value = "Schema.mutableKey(" + value + ")"
		}
		comment := ""
		if mode&512 != 0 {
			comment = "/* keep field comment */"
		}
		prefix := ""
		if mode&1 != 0 {
			prefix = "export "
		}
		constant := prefix + "const User=Schema.Struct({value:" + comment + value + "});\n"
		aliasName := "User"
		if mode&128 != 0 {
			aliasName = "Other" // a valid alias that does not match the constant
		}
		alias := prefix + "type " + aliasName + "=typeof User.Type;\n"
		if mode&256 != 0 {
			constant = "/** Keep value documentation. */\n" + constant
		}
		body := constant + alias
		if mode&64 != 0 {
			body = alias + constant
		}
		if mode&4 != 0 {
			body = "export namespace Models {\n" + body + "}\n"
		}
		header := "import {Schema} from \"effect\";\n"
		if mode&2 != 0 {
			header = "import * as Schema from \"effect/Schema\";\n"
		}
		severity := []string{"warning", "error", "suggestion", "off"}[(mode>>10)%4]
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe"],"vibe":{"severities":{"EK4832":"off","EK4841":%q}}}`, severity)
		source := header + body
		result, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		allDiagnostics := result.Diagnostics
		loaded := false
		if result.Program != nil {
			for _, file := range result.Program.GetSourceFiles() {
				if strings.HasSuffix(file.FileName().AsString(), "/main.vibe") {
					loaded = true
					// Suggestions are queried separately from semantic diagnostics.
					allDiagnostics = append(allDiagnostics, result.Program.GetSuggestionDiagnostics(t.Context(), file)...)
				}
			}
		}
		if !loaded {
			t.Fatal("generated main.vibe was not loaded")
		}
		want := mode&(64|128|256|512) == 0 && severity != "off"
		found := false
		for _, d := range allDiagnostics {
			if d.Source() == "EK" && d.Code() == 4841 {
				found = true
				category := diagnostics.CategoryWarning
				if severity == "error" {
					category = diagnostics.CategoryError
				} else if severity == "suggestion" {
					category = diagnostics.CategorySuggestion
				}
				if d.Category() != category {
					Gap(t, target, fmt.Sprintf("severity:%s:%d", key, mode), "EK4841 category %v, want %v", d.Category(), category)
				}
			} else if d.Category() == diagnostics.CategoryError {
				t.Fatalf("invalid generated source: %s\n%s", d.String(), header+body)
			}
		}
		if found != want {
			Gap(t, target, fmt.Sprintf("warning:%s:%d", key, mode), "EK4841 present %v, want %v at severity %s\n%s", found, want, severity, header+body)
		}
	})
}

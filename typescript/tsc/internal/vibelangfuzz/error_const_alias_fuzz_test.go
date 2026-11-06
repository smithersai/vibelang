package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const errorAliasTarget = "FuzzErrorConstAliasArity"
const errorAliasQuote = "its known length lies outside the admitted interval"
const errorAliasExtractQuote = "returns `[subject]`"

func errorAliasQuotes(t testing.TB) {
	t.Helper()
	for _, quote := range []string{errorAliasQuote, errorAliasExtractQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("fixed error extraction rule changed: %s", quote)
		}
	}
}
func TestErrorConstAliasArityQuoted(t *testing.T) { errorAliasQuotes(t) }

var errorAliasKeys = []string{
	"plain-direct", "plain-const", "plain-typed", "plain-chain", "plain-import", "plain-namespace", "plain-mutable", "plain-declared",
	"schema-direct", "schema-const", "schema-typed", "schema-chain", "schema-import", "schema-namespace", "schema-mutable", "schema-declared",
}
var errorAliasArgs = []string{"", "let value", "let first,let second"}

// A const initializer preserves constructor identity through local aliases.
// Opaque constructor types do not establish a fixed extraction protocol.
func FuzzErrorConstAliasArity(f *testing.F) {
	startShortBudget(f)
	errorAliasQuotes(f)
	for index, key := range errorAliasKeys {
		for shape := uint8(0); shape < 3; shape++ {
			f.Add(key, shape, uint8(index+int(shape))%4)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape, context uint8) {
		index := slices.Index(errorAliasKeys, key)
		if index < 0 {
			index = int(shape) % len(errorAliasKeys)
			key = errorAliasKeys[index]
		}
		kind := "error"
		if index >= 8 {
			kind = "schema error"
		}
		which := index % 8
		declaration := kind + " E{code:number};"
		prefix, setup, target, matcher := declaration, "", "E", "E"
		files := map[string]string{}
		if which == 4 || which == 5 {
			files["types.vibe"] = "export " + declaration
			prefix = `import {E as Imported} from "./types.js";`
			target = "Imported"
			if which == 5 {
				prefix = `import * as Errors from "./types.js";`
				target = "Errors.E"
			}
		}
		initializer := target
		if context&2 != 0 {
			initializer = "((" + target + "))"
		}
		switch which {
		case 1, 4, 5:
			setup = "const Match=" + initializer + ";"
			matcher = "Match"
		case 2:
			setup = "const Match:typeof E=" + initializer + ";"
			matcher = "Match"
		case 3:
			setup = "const First=" + initializer + ";const Match=First;"
			matcher = "Match"
		case 6:
			setup = "declare let Match:typeof E;"
			matcher = "Match"
		case 7:
			setup = "declare const Match:typeof E;"
			matcher = "Match"
		}
		modifier := ""
		if context&1 != 0 {
			modifier = "effect "
		}
		source := prefix + setup + fmt.Sprintf("export %sfunction f(subject:unknown){return match(subject){when %s(%s):1;default:0;}}", modifier, matcher, errorAliasArgs[shape%3])
		files["main.vibe"] = source
		result, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if diagnosticKey(d) == "EK0703" {
				count++
				if d.Category() != diagnostics.CategoryWarning {
					Gap(t, errorAliasTarget, "severity:"+key, "not a warning: %s", specDiagnosticText(d))
					return
				}
			} else if d.Category() == diagnostics.CategoryError {
				Gap(t, errorAliasTarget, "diagnostic:"+key, "unexpected %s\n%s", specDiagnosticText(d), source)
				return
			}
		}
		want := 0
		if which < 6 && shape%3 != 1 {
			want = 1
		}
		if count != want {
			Gap(t, errorAliasTarget, fmt.Sprintf("arity:%s:%d", key, shape%3), "%s: got %d EK0703, want %d\n%s", errorAliasQuote, count, want, source)
		}
	})
}

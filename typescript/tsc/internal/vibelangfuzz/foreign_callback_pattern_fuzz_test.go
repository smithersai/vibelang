package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const foreignCallbackPatternQuote = "The names are pattern syntax, not values exported by Effect 4.1.1."

func foreignCallbackPatternKeys() []string {
	var keys []string
	for _, variant := range []string{"Option.Some", "Option.None", "Exit.Success", "Exit.Failure", "Result.Success", "Result.Failure"} {
		for _, form := range []string{"match", "extract", "is"} {
			for _, binding := range []string{"direct", "alias"} {
				keys = append(keys, variant+"/"+form+"/"+binding)
			}
		}
	}
	return append(keys, "user-callback/arm", "user-callback/guard")
}
func TestForeignCallbackPatternsQuoted(t *testing.T) {
	r4Quoted(t, "004-match.md", foreignCallbackPatternQuote)
	r4Quoted(t, "003-failures.md", foreignVariableQuote, foreignVariableAdmissionQuote)
}
func TestForeignCallbackPatternKeys(t *testing.T) {
	keys := foreignCallbackPatternKeys()
	if len(keys) != 38 {
		t.Fatal(len(keys))
	}
	for _, key := range keys {
		p := filepath.Join("testdata/fuzz/FuzzForeignCallbackPatterns", strings.ReplaceAll(key, "/", "-"))
		b, err := os.ReadFile(p)
		if err != nil || !strings.Contains(string(b), fmt.Sprintf("[]byte(%q)", "key:"+key)) {
			t.Fatalf("%s: %v", p, err)
		}
	}
}
func FuzzForeignCallbackPatterns(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "004-match.md", foreignCallbackPatternQuote)
	r4Quoted(f, "003-failures.md", foreignVariableQuote, foreignVariableAdmissionQuote)
	keys := foreignCallbackPatternKeys()
	r4Seeds(f, keys)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := keys[r4Pick(data, keys)]
		parts := strings.Split(key, "/")
		helpers := "export declare const source:()=>unknown\n/** @throws {never} */\nexport declare function consume(fn:()=>unknown):void\n"
		source := "import {source,consume} from \"./helpers.js\"\n"
		want := false
		if parts[0] == "user-callback" {
			want = true
			source += "import * as Option from \"effect/Option\"\n"
			if parts[1] == "arm" {
				source += "function probe(x:unknown){return match(x){when Option.Some:consume(source);default:0;}}\n"
			} else {
				source += "function probe(x:unknown){return match(x){when Option.Some and if (consume(source)===undefined):1;default:0;}}\n"
			}
		} else {
			module := strings.Split(parts[0], ".")[0]
			binding := module
			if parts[2] == "alias" {
				binding = "Alias"
			}
			source += "import * as " + binding + " from \"effect/" + module + "\"\n"
			pattern := binding + "." + strings.Split(parts[0], ".")[1]
			if parts[1] == "extract" {
				if parts[0] == "Option.None" {
					pattern += "()"
				} else {
					pattern += "(let value)"
				}
			}
			if parts[1] == "is" {
				source += "function probe(x:unknown){return x is " + pattern + "}\n"
			} else {
				source += "function probe(x:unknown){return match(x){when " + pattern + ":1;default:0;}}\n"
			}
		}
		files := map[string]string{"main.vibe": source, "helpers.d.ts": helpers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\",\"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r4Errors(r.Diagnostics)
		if len(errors) > 1 || len(errors) == 1 && errors[0] != "EK0402" || (len(errors) == 1) != want {
			Gap(t, "FuzzForeignCallbackPatterns", "pattern:"+key, "004-match: %s; 003-failures: %s; key %s got%v want EK0402=%t\n%s", foreignCallbackPatternQuote, foreignVariableAdmissionQuote, key, errors, want, Archive(files))
		} else {
			// The key names this one probe, so a pending line for it is stale.
			ExpectPending(t, "FuzzForeignCallbackPatterns", "pattern:"+key)
		}
	})
}

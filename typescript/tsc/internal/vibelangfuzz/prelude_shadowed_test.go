package vibelangfuzz

import (
	"crypto/sha256"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"
)

const preludeShadowedTarget = "FuzzPreludeShadowed"
const preludeShadowedQuote = "A local declaration or import shadows one, as with any global."

func TestPreludeShadowedQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), preludeShadowedQuote) {
		t.Fatalf("Chapter 5 no longer says %q", preludeShadowedQuote)
	}
}

// preludeShadowedSource is the program a key names, binding:name:form:use.
// A source binding named like an Effect root module (sst's Resource,
// opencode-43) is read inside each Effect form and in a plain function.
func preludeShadowedSource(key string) (string, map[string]string) {
	parts := strings.Split(key, ":")
	binding, name, form, use := parts[0], parts[1], parts[2], parts[3]
	files := map[string]string{"package.json": "{\"type\":\"module\"}"}
	value := "{ App: { stage: \"dev\" }, get: (): string => \"dev\" }"
	var head string
	switch binding {
	case "import":
		files["dep.ts"] = "export const " + name + " = " + value + "\n"
		head = "import { " + name + " } from \"./dep.js\"\n"
	case "import-as":
		files["dep.ts"] = "export const thing = " + value + "\n"
		head = "import { thing as " + name + " } from \"./dep.js\"\n"
	case "const":
		head = "const " + name + " = " + value + "\n"
	case "let":
		head = "let " + name + " = " + value + "\n"
	case "class":
		head = "class " + name + " { static App = { stage: \"dev\" }; static get(): string { return \"dev\" } }\n"
	}
	expression := map[string]string{"member": name + ".App.stage", "call": name + ".get()", "bare": "String(" + name + " !== undefined)"}[use]
	body := map[string]string{
		"effect-function": "export effect function read() { return " + expression + " }\n",
		"arrow":           "export const read = () => " + expression + "\n",
		"effect-arrow":    "export const read = effect () => " + expression + "\n",
		"effect-block":    "export const read = effect { return " + expression + " }\n",
		"plain":           "export function read(): string { return " + expression + " }\n",
	}[form]
	files["main.vibe"] = head + body
	return files["main.vibe"], files
}

var preludeShadowedNames = []string{"Resource", "Option", "Schema", "Layer", "Stream", "Duration", "Data", "Context"}

func preludeShadowedKeys() []string {
	var keys []string
	for _, binding := range []string{"import", "import-as", "const", "let", "class"} {
		for _, name := range preludeShadowedNames {
			for _, form := range []string{"effect-function", "arrow", "effect-arrow", "effect-block", "plain"} {
				for _, use := range []string{"member", "call", "bare"} {
					// Calling an imported TypeScript function from Effect code needs a
					// hatch (EK4401), so only a local binding's method is called.
					if strings.HasPrefix(binding, "import") && use == "call" {
						continue
					}
					keys = append(keys, binding+":"+name+":"+form+":"+use)
				}
			}
		}
	}
	return keys
}

// Chapter 5: a local declaration or import shadows an Effect root module's
// name. The emitted module therefore binds the name once, the source's way,
// and imports no effect/<Name> namespace under it; a second binding fails at
// load ("Identifier 'Resource' has already been declared", opencode-43).
func FuzzPreludeShadowed(f *testing.F) {
	startShortBudget(f)
	keys := preludeShadowedKeys()
	for _, key := range keys {
		// The short seeds cover every binding, form and use for Resource and one
		// program for each other name; the full set runs under -fuzz.
		if testing.Short() && !strings.Contains(key, ":Resource:") && !strings.HasPrefix(key, "import:") || testing.Short() && strings.HasPrefix(key, "import:") && !strings.Contains(key, ":Resource:") && !strings.HasSuffix(key, ":effect-function:member") {
			continue
		}
		source, _ := preludeShadowedSource(key)
		f.Add(key, source)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, source string) {
		TestPreludeShadowedQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		if len(source) > 16<<10 {
			return
		}
		known, files := preludeShadowedSource(key)
		name := strings.Split(key, ":")[1]
		files["main.vibe"] = source
		if reason := Admissible(Single(source)); reason != "" {
			return
		}
		var result *Result
		var err error
		within(t, "compile shadowed prelude name", func() {
			result, err = w.Compile(t.Context(), Project{Files: files, Config: DefaultConfig})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		if HasError(result.Diagnostics) {
			if source != known {
				t.Skip("mutated program is not well typed")
			}
			t.Fatalf("shadowed-prelude witness must compile: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
		var js string
		for output, text := range result.Outputs {
			if strings.HasSuffix(output, "main.js") {
				js = text
			}
		}
		if js == "" {
			t.Fatalf("no main.js emitted for\n%s", source)
		}
		quoted := regexp.QuoteMeta(name)
		bindings := regexp.MustCompile(`(?m)(?:import\s+\*\s+as\s+`+quoted+`\b|import\s*\{[^}]*\b(?:as\s+)?`+quoted+`\s*[,}]|^\s*(?:const|let|var|class|function)\s+`+quoted+`\b)`).FindAllString(js, -1)
		effectModule := regexp.MustCompile(`import\s+\*\s+as\s+` + quoted + `\s+from\s+"effect/`).MatchString(js)
		gapKey := "emit:" + key
		if source != known {
			gapKey += fmt.Sprintf(":%x", sha256.Sum256([]byte(source)))
		}
		if effectModule || (source == known && len(bindings) != 1) {
			Gap(t, preludeShadowedTarget, gapKey, "Chapter 5: %q; the emitted module binds %s %d time(s), effect module import %v\n%s\n--- emitted\n%s", preludeShadowedQuote, name, len(bindings), effectModule, source, js)
		}
		ExpectPending(t, preludeShadowedTarget, gapKey)
		ExpectPending(t, preludeShadowedTarget, specCorpusKey(t))
	})
}

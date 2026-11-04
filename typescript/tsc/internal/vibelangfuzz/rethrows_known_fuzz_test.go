package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const rethrowsKnownQuote = "A call, \x60new\x60 expression, tagged template or class evaluation *known to throw* is \x60EK0401\x60, unless it sits in the \x60try\x60 block of a \x60try\x60 statement with a \x60catch\x60 clause in the same function."

const rethrowsContributionQuote = "its own thrown type, plus the thrown type of the callback passed for \x60p\x60; \x60@throws {never}\x60 does not erase it"

var rethrowsKnownContracts = []string{"never", "Error", "unknown", "effect", "JSON.parse", "decodeURI", "decodeURIComponent", "BigInt"}
var rethrowsKnownSites = []string{"call", "new", "tag"}
var rethrowsKnownBoundaries = []string{"plain", "caught", "Effect.try"}

type rethrowsKnownVariant struct {
	contract, site, boundary int
	alias                    bool
}

func (v rethrowsKnownVariant) name() string {
	ref := "direct"
	if v.alias {
		ref = "alias"
	}
	return fmt.Sprintf("%s/%s/%s/%s", rethrowsKnownContracts[v.contract], rethrowsKnownSites[v.site], rethrowsKnownBoundaries[v.boundary], ref)
}
func rethrowsKnownVariants() ([]rethrowsKnownVariant, []string) {
	var variants []rethrowsKnownVariant
	var names []string
	for contract := range rethrowsKnownContracts {
		for site := range rethrowsKnownSites {
			for boundary := range rethrowsKnownBoundaries {
				limit := 2
				if contract >= 4 {
					limit = 1
				}
				for alias := 0; alias < limit; alias++ {
					v := rethrowsKnownVariant{contract, site, boundary, alias == 1}
					variants = append(variants, v)
					names = append(names, v.name())
				}
			}
		}
	}
	return variants, names
}
func TestKnownRethrowsQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", rethrowsKnownQuote, rethrowsContributionQuote)
}
func TestKnownRethrowsKeys(t *testing.T) {
	_, names := rethrowsKnownVariants()
	if len(names) != 108 {
		t.Fatalf("got %d keys", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzKnownRethrows", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatal(p)
		}
	}
}
func FuzzKnownRethrows(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", rethrowsKnownQuote, rethrowsContributionQuote)
	variants, names := rethrowsKnownVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		helpers := "import type * as Effect from \"effect/Effect\"\n"
		value := "source"
		if v.contract < 4 {
			result := "unknown"
			tag := rethrowsKnownContracts[v.contract]
			if v.contract == 3 {
				result = "Effect.Effect<number>"
				tag = "Error"
			}
			helpers += fmt.Sprintf("/** @throws {%s} */\nexport declare function source(text:string):%s\n", tag, result)
		} else {
			value = rethrowsKnownContracts[v.contract]
		}
		helpers += "/** @throws {never} @rethrows cb */\nexport declare function invoke(cb:(text:string)=>unknown):unknown\n"
		helpers += "export interface Builder {\n/** @throws {never} @rethrows cb */\nnew(cb:(text:string)=>unknown):object\n}\nexport declare const Builder:Builder\n"
		helpers += "/** @throws {never} @rethrows cb */\nexport declare function tag(parts:TemplateStringsArray,cb:(text:string)=>unknown):unknown\n"
		imports := "import {invoke,Builder,tag"
		if v.contract < 4 {
			imports += ",source"
		}
		imports += "} from \"./helpers.js\"\nimport * as Effect from \"effect/Effect\"\n"
		if v.alias {
			imports += "const callback=source\n"
			value = "callback"
		}
		expression := "invoke(" + value + ")"
		if v.site == 1 {
			expression = "new Builder(" + value + ")"
		}
		if v.site == 2 {
			expression = "tag\x60x$" + "{" + value + "}\x60"
		}
		body := "return " + expression
		if v.boundary == 1 {
			body = "try {return " + expression + "} catch {return undefined}"
		}
		if v.boundary == 2 {
			body = "return Effect.try(() => " + expression + ")"
		}
		main := imports + "export function probe(){" + body + "}\n"
		files := map[string]string{"main.vibe": main, "helpers.d.ts": helpers}
		config := strings.Replace(DefaultConfig, "\"target\": \"ES2022\",", "\"target\": \"ES2022\", \"lib\":[\"esnext\",\"dom\"],", 1)
		config = strings.TrimSuffix(config, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\",\"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r4Errors(r.Diagnostics)
		want := v.boundary == 0 && v.contract != 0 && v.contract != 3
		if len(errors) > 1 || len(errors) == 1 && errors[0] != "EK0401" || (len(errors) == 1) != want {
			Gap(t, "FuzzKnownRethrows", "contract:"+v.name(), "003-failures: %s; key %s got %v want EK0401=%t\n%s", rethrowsKnownQuote, v.name(), errors, want, Archive(files))
		}
	})
}

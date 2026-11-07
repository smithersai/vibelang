package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TypeScript relates two overloaded signature lists with their type
// parameters erased, so a member with fewer generic overloads than its
// interface still implements it. The thrown-type check pairs the same
// signatures: the contract of the overload TypeScript pairs decides, never the
// absence of a strictly instantiated match.
const (
	overloadImplementsQuote = "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and \x60implements\x60, with \x60service\x60 members as interface members."
	overloadVibeQuote       = "A callable declared in VibeLang (\x60.vibe\x60 or \x60.vibex\x60, outside a \x60module\x60 body) has thrown type \x60never\x60."
	overloadTagQuote        = "Tags attach to call signatures: each overload and a returned callable's own signature carry their own."
	overloadAdmitQuote      = "a type without \x60@throws\x60 admits only \x60never\x60, \x60@throws {U}\x60 admits subtypes of \x60U\x60"
)

// The first n of these overloads form each provided and required list.
var overloadSignatures = []string{
	"<A>(a:A):A",
	"<A,B>(a:A,ab:(_:A)=>B):B",
	"<A,B,C>(a:A,ab:(_:A)=>B,bc:(_:B)=>C):C",
}

// Provided-of-required counts: the lone pair, and each mix TypeScript erases.
var overloadShapes = [][2]int{{1, 1}, {1, 3}, {2, 3}, {3, 1}, {3, 3}}
var overloadSources = []string{"vibe", "never", "Error", "untagged"}
var overloadBounds = []string{"untagged", "Error"}
var overloadSites = []string{"implements", "initializer"}

type overloadVariant struct{ source, shape, bound, site int }

func (v overloadVariant) name() string {
	s := overloadShapes[v.shape]
	return fmt.Sprintf("%s/%d-of-%d/to-%s/%s", overloadSources[v.source], s[0], s[1], overloadBounds[v.bound], overloadSites[v.site])
}

func overloadVariants() ([]overloadVariant, []string) {
	var variants []overloadVariant
	var names []string
	for source := range overloadSources {
		for shape := range overloadShapes {
			for bound := range overloadBounds {
				for site := range overloadSites {
					v := overloadVariant{source, shape, bound, site}
					variants = append(variants, v)
					names = append(names, v.name())
				}
			}
		}
	}
	return variants, names
}

func (v overloadVariant) files() map[string]string {
	provided, required := overloadShapes[v.shape][0], overloadShapes[v.shape][1]
	bound := ""
	if v.bound != 0 {
		bound = "/** @throws {" + overloadBounds[v.bound] + "} */ "
	}
	helpers := "export interface API {\n"
	for _, signature := range overloadSignatures[:required] {
		helpers += bound + "apply" + signature + "\n"
	}
	helpers += "}\n"
	if v.source != 0 {
		tag := ""
		if v.source != 3 {
			tag = "/** @throws {" + overloadSources[v.source] + "} */ "
		}
		for _, signature := range overloadSignatures[:provided] {
			helpers += tag + "export declare function source" + signature + "\n"
		}
	}
	main := "import {type API} from \"./helpers.js\"\n"
	value := "source"
	if v.source == 0 {
		value = "local"
		if v.site == 0 {
			main += "export class Box implements API {\n"
			main += overloadMethod("apply", provided)
			main += "}\n"
		} else {
			main += overloadMethod("function local", provided)
		}
	} else {
		main = "import {source,type API} from \"./helpers.js\"\n"
		if v.site == 0 {
			main += "export class Box implements API {apply=source}\n"
		}
	}
	if v.site == 1 {
		main += "export const run:API[\"apply\"]=" + value + "\n"
	}
	return map[string]string{"main.vibe": main, "helpers.d.ts": helpers}
}

// overloadMethod writes a VibeLang callable with the first n overloads: a lone
// generic signature has its own body, and a list shares one implementation.
func overloadMethod(head string, n int) string {
	if n == 1 {
		return head + "<A>(a:A):A {return a}\n"
	}
	out := ""
	for _, signature := range overloadSignatures[:n] {
		out += head + signature + "\n"
	}
	return out + head + "(a:unknown,...fs:ReadonlyArray<(_:never)=>unknown>):unknown {return fs.length===0?a:a}\n"
}

// want reports EK0402 exactly when the provided contract is not admitted:
// VibeLang callables and @throws {never} fit any bound, a written Error fits
// an Error bound, and an untagged foreign function throws unknown.
func (v overloadVariant) want() bool {
	switch overloadSources[v.source] {
	case "vibe", "never":
		return false
	case "Error":
		return v.bound == 0
	}
	return true
}

func TestOverloadImplementsContractsQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", overloadImplementsQuote, overloadVibeQuote, overloadTagQuote, overloadAdmitQuote)
}

func TestOverloadImplementsContractKeys(t *testing.T) {
	_, names := overloadVariants()
	if len(names) != 80 {
		t.Fatalf("got %d keys, want 80", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzOverloadImplementsContracts", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key %s", p)
		}
	}
}

func FuzzOverloadImplementsContracts(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", overloadImplementsQuote, overloadVibeQuote, overloadTagQuote, overloadAdmitQuote)
	variants, names := overloadVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		files := v.files()
		config := strings.Replace(DefaultConfig, "\"target\": \"ES2022\",", "\"target\": \"ES2022\", \"lib\":[\"esnext\",\"dom\"],", 1)
		config = strings.TrimSuffix(config, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\",\"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		want := v.want()
		if len(errs) > 1 || len(errs) == 1 && errs[0] != "EK0402" || (len(errs) == 1) != want {
			Gap(t, "FuzzOverloadImplementsContracts", "overload:"+v.name(), "003-failures: %s %s; key %s got %v, want EK0402=%t\n%s", overloadImplementsQuote, overloadVibeQuote, v.name(), errs, want, Archive(files))
		}
	})
}

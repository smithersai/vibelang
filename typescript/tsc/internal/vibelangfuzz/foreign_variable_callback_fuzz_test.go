package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const foreignVariableQuote = "| no tag | \x60unknown\x60 |"
const foreignVariableAdmissionQuote = "a type without \x60@throws\x60 admits only \x60never\x60"
const foreignVariableAliasQuote = "\x60const g = f\x60 preserves \x60f\x60's contract"
const foreignVariableVibeQuote = "has thrown type \x60never\x60. Nothing is inferred from a body."
const foreignVariableEffectQuote = "A generic signature is classified as effectful before type-argument substitution, through its constraints."
const foreignVariableWrittenQuote = "| \x60/** @throws {T} */\x60 on it or its call signature | \x60T\x60, trusted, not checked |"
const foreignVariableModuleQuote = "an npm package or a \x60module\x60 body (VIP-40)"

var foreignVariableSources = []string{"function-type", "call-signature", "alias", "effect", "never", "vibe", "property", "captured-effect", "own-instantiation", "module-never-alias"}
var foreignVariableBounds = []string{"untagged", "Error", "unknown"}
var foreignVariableSites = []string{"argument", "initializer", "return", "member", "class-field", "inherited"}

type foreignVariableVariant struct{ source, bound, site int }

func (v foreignVariableVariant) name() string {
	return fmt.Sprintf("%s/%s/%s", foreignVariableSources[v.source], foreignVariableBounds[v.bound], foreignVariableSites[v.site])
}
func foreignVariableVariants() ([]foreignVariableVariant, []string) {
	var variants []foreignVariableVariant
	var names []string
	for source := range foreignVariableSources {
		for bound := range foreignVariableBounds {
			for site := range foreignVariableSites {
				v := foreignVariableVariant{source, bound, site}
				variants = append(variants, v)
				names = append(names, v.name())
			}
		}
	}
	return variants, names
}
func TestForeignVariableCallbacksQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", foreignVariableQuote, foreignVariableAdmissionQuote, foreignVariableAliasQuote, foreignVariableVibeQuote, foreignVariableEffectQuote, foreignVariableWrittenQuote, foreignVariableModuleQuote)
}
func TestForeignVariableCallbackKeys(t *testing.T) {
	_, names := foreignVariableVariants()
	if len(names) != 180 {
		t.Fatalf("got%d keys", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzForeignVariableCallbacks", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatal(p)
		}
	}
}
func FuzzForeignVariableCallbacks(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", foreignVariableQuote, foreignVariableAdmissionQuote, foreignVariableAliasQuote, foreignVariableVibeQuote, foreignVariableEffectQuote, foreignVariableWrittenQuote, foreignVariableModuleQuote)
	variants, names := foreignVariableVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		bound := ""
		if v.bound != 0 {
			bound = "/** @throws {" + foreignVariableBounds[v.bound] + "} */\n"
		}
		helpers := "import type * as Effect from \"effect/Effect\"\nexport declare const source:()=>unknown\n"
		if v.source == 1 {
			helpers = "export declare const source:{():unknown}\n"
		}
		if v.source == 3 {
			helpers = "import type * as Effect from \"effect/Effect\"\nexport declare const source:()=>Effect.Effect<number>\n"
		}
		if v.source == 4 {
			helpers = "/** @throws {never} */\nexport declare const source:()=>unknown\n"
		}
		helpers += "export interface Handler {\n" + bound + "():unknown\n}\nexport interface API {run:Handler}\n/** @throws {never} */\nexport declare function consume(fn:Handler):void\n"
		helpers += "import type * as FX from \"effect/Effect\"\nexport interface Owner<R>{run:()=>R}\nexport declare const owner:Owner<unknown>\nexport declare const fxOwner:Owner<FX.Effect<number>>\nexport declare const generic:<T>()=>T\n"
		prefix := "import {source,consume,owner,fxOwner,generic,type API,type Handler} from \"./helpers.js\"\nimport type * as Effect from \"effect/Effect\"\n"
		value := "source"
		switch v.source {
		case 2:
			prefix += "const alias=source\n"
			value = "alias"
		case 5:
			prefix += "function local(){return 1}\n"
			value = "local"
		case 6:
			value = "owner.run"
		case 7:
			value = "fxOwner.run"
		case 8:
			prefix += "const value=generic<Effect.Effect<number>>\n"
			value = "value"
		case 9:
			prefix += "module LocalForeign {\nexport type Fn=()=>unknown\n/** @throws {never} */\nexport const safe:Fn=()=>1\n}\nimport {safe as moduleSafe} from LocalForeign\nconst moduleAlias=moduleSafe\n"
			value = "moduleAlias"
		}
		body := ""
		switch v.site {
		case 0:
			body = "export function probe(){consume(" + value + ")}\n"
		case 1:
			body = "export const bound:Handler=" + value + "\n"
		case 2:
			body = "export function probe():Handler{return " + value + "}\n"
		case 3:
			body = "export const entry:API={run:" + value + "}\n"
		case 4:
			body = "export class Box implements API {run=" + value + "}\n"
		case 5:
			body = "class Parent {run=" + value + "}\nexport class Box extends Parent implements API {}\n"
		}
		files := map[string]string{"main.vibe": prefix + body, "helpers.d.ts": helpers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\",\"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r4Errors(r.Diagnostics)
		unsafe := v.source == 0 || v.source == 1 || v.source == 2 || v.source == 6 || v.source == 8
		want := unsafe && v.bound != 2
		if len(errors) > 1 || len(errors) == 1 && errors[0] != "EK0402" || (len(errors) == 1) != want {
			Gap(t, "FuzzForeignVariableCallbacks", "contract:"+v.name(), "003-failures: %s; %s; key%s got%v want EK0402=%t\n%s", foreignVariableQuote, foreignVariableAdmissionQuote, v.name(), errors, want, Archive(files))
		}
	})
}

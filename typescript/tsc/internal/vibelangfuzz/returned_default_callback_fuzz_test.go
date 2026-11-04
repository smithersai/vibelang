package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const returnedDefaultQuote = "each overload and a returned callable's own signature carry their own."

var returnedDefaultSources = []string{"function", "variable", "method", "module", "alias-factory", "alias-value", "effect", "safe", "vibe", "vibe-written", "own-generic", "captured-effect", "construct", "tag"}

type returnedDefaultVariant struct{ source, bound, site int }

func (v returnedDefaultVariant) name() string {
	return fmt.Sprintf("%s/%s/%s", returnedDefaultSources[v.source], foreignVariableBounds[v.bound], foreignVariableSites[v.site])
}
func returnedDefaultVariants() ([]returnedDefaultVariant, []string) {
	var variants []returnedDefaultVariant
	var names []string
	for source := range returnedDefaultSources {
		for bound := range foreignVariableBounds {
			for site := range foreignVariableSites {
				v := returnedDefaultVariant{source, bound, site}
				variants = append(variants, v)
				names = append(names, v.name())
			}
		}
	}
	return variants, names
}
func TestReturnedDefaultCallbacksQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", returnedDefaultQuote, foreignVariableQuote, foreignVariableAdmissionQuote, foreignVariableAliasQuote, foreignVariableEffectQuote)
}
func TestReturnedDefaultCallbackKeys(t *testing.T) {
	_, names := returnedDefaultVariants()
	if len(names) != 252 {
		t.Fatal(len(names))
	}
	for _, name := range names {
		p := filepath.Join("testdata/fuzz/FuzzReturnedDefaultCallbacks", strings.ReplaceAll(name, "/", "-"))
		b, err := os.ReadFile(p)
		if err != nil || !strings.Contains(string(b), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("%s: %v", p, err)
		}
	}
}
func FuzzReturnedDefaultCallbacks(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", returnedDefaultQuote, foreignVariableQuote, foreignVariableAdmissionQuote, foreignVariableAliasQuote, foreignVariableEffectQuote)
	variants, names := returnedDefaultVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		bound := ""
		if v.bound != 0 {
			bound = "/** @throws {" + foreignVariableBounds[v.bound] + "} */\n"
		}
		helpers := "import type * as Effect from \"effect/Effect\"\nexport type Fn=()=>number\n"
		helpers += "/** @throws {never} */\nexport declare function make():()=>number\n"
		helpers += "/** @throws {never} */\nexport declare const makeVar:()=>()=>number\n"
		helpers += "export declare const api:{\n/** @throws {never} */\nmake():()=>number\n}\n"
		helpers += "/** @throws {never} */\nexport declare function makeEffect():()=>Effect.Effect<number>\n"
		helpers += "/** @throws {never} */\nexport declare function makeSafe():{\n/** @throws {never} */\n():number\n}\n"
		helpers += "/** @throws {never} */\nexport declare function makeGeneric():<T>()=>T\n"
		helpers += "/** @throws {never} */\nexport declare function makeCaptured<T>():()=>T\n"
		helpers += "/** @throws {never} */\nexport declare const Ctor:{new():()=>number}\n"
		helpers += "/** @throws {never} */\nexport declare function makeTag(strings:TemplateStringsArray):()=>number\n"
		helpers += "export interface Handler {\n" + bound + "():unknown\n}\nexport interface API {run:Handler}\n/** @throws {never} */\nexport declare function consume(fn:Handler):void\n"
		prefix := "import {make,makeVar,api,makeEffect,makeSafe,makeGeneric,makeCaptured,Ctor,makeTag,consume,type Fn,type Handler,type API} from \"./helpers.js\"\nimport type * as Effect from \"effect/Effect\"\n"
		value := "make()"
		switch v.source {
		case 1:
			value = "makeVar()"
		case 2:
			value = "api.make()"
		case 3:
			prefix += "module LocalFactory {\nexport function create():()=>number{return()=>1}\n}\nimport {create as moduleMake} from LocalFactory\n"
			value = "moduleMake()"
		case 4:
			prefix += "const factory=make\n"
			value = "factory()"
		case 5:
			prefix += "const produced=make()\n"
			value = "produced"
		case 6:
			value = "makeEffect()"
		case 7:
			value = "makeSafe()"
		case 8:
			prefix += "function localFactory(){return()=>1}\n"
			value = "localFactory()"
		case 9:
			prefix += "function localFactory():Fn{return()=>1}\n"
			value = "localFactory()"
		case 10:
			prefix += "const generic=makeGeneric()<Effect.Effect<number>>\n"
			value = "generic"
		case 11:
			value = "makeCaptured<Effect.Effect<number>>()"
		case 12:
			value = "new Ctor()"
		case 13:
			value = "makeTag\x60\x60"
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
			body = "export class Box implements API{run=" + value + "}\n"
		case 5:
			body = "class Parent{run=" + value + "}\nexport class Box extends Parent implements API{}\n"
		}
		files := map[string]string{"main.vibe": prefix + body, "helpers.d.ts": helpers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\",\"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r4Errors(r.Diagnostics)
		unsafe := v.source <= 5 || v.source == 10 || v.source == 12 || v.source == 13
		want := unsafe && v.bound != 2
		if len(errors) > 1 || len(errors) == 1 && errors[0] != "EK0402" || (len(errors) == 1) != want {
			Gap(t, "FuzzReturnedDefaultCallbacks", "contract:"+v.name(), "003-failures: %s; %s; key%s got%v want EK0402=%t\n%s", returnedDefaultQuote, foreignVariableAdmissionQuote, v.name(), errors, want, Archive(files))
		}
	})
}

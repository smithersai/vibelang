package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var instantiatedDefaultSources = []string{"function", "captured-method", "variable", "returned"}
var instantiatedDefaultConstraints = []string{"unknown", "effect", "mixed", "never", "stream", "layer"}

type instantiatedDefaultVariant struct{ source, constraint, bound, site int }

func (v instantiatedDefaultVariant) name() string {
	return fmt.Sprintf("%s/%s/%s/%s", instantiatedDefaultSources[v.source], instantiatedDefaultConstraints[v.constraint], foreignVariableBounds[v.bound], foreignVariableSites[v.site])
}
func instantiatedDefaultVariants() ([]instantiatedDefaultVariant, []string) {
	var variants []instantiatedDefaultVariant
	var names []string
	for source := range instantiatedDefaultSources {
		for constraint := range instantiatedDefaultConstraints {
			for bound := range foreignVariableBounds {
				for site := range foreignVariableSites {
					v := instantiatedDefaultVariant{source, constraint, bound, site}
					variants = append(variants, v)
					names = append(names, v.name())
				}
			}
		}
	}
	return variants, names
}
func TestInstantiatedDefaultCallbacksQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", foreignVariableQuote, foreignVariableAdmissionQuote, foreignVariableEffectQuote)
}
func TestInstantiatedDefaultCallbackKeys(t *testing.T) {
	_, names := instantiatedDefaultVariants()
	if len(names) != 432 {
		t.Fatal(len(names))
	}
	for _, name := range names {
		p := filepath.Join("testdata/fuzz/FuzzInstantiatedDefaultCallbacks", strings.ReplaceAll(name, "/", "-"))
		b, err := os.ReadFile(p)
		if err != nil || !strings.Contains(string(b), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("%s: %v", p, err)
		}
	}
}
func FuzzInstantiatedDefaultCallbacks(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", foreignVariableQuote, foreignVariableAdmissionQuote, foreignVariableEffectQuote)
	variants, names := instantiatedDefaultVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		bound := ""
		if v.bound != 0 {
			bound = "/** @throws {" + foreignVariableBounds[v.bound] + "} */\n"
		}
		constraint := []string{"unknown", "Effect.Effect<any,any,any>", "Effect.Effect<number>|undefined", "never", "Stream.Stream<any,any,any>", "Layer.Layer<any,any,any>"}[v.constraint]
		chosen := "Effect.Effect<number>"
		if v.constraint == 3 {
			chosen = "never"
		}
		if v.constraint == 4 {
			chosen = "Stream.Stream<number>"
		}
		if v.constraint == 5 {
			chosen = "Layer.Layer<any,any,any>"
		}
		helpers := "import type * as Effect from \"effect/Effect\"\nimport type * as Stream from \"effect/Stream\"\nimport type * as Layer from \"effect/Layer\"\n"
		helpers += "export declare function generic<T extends " + constraint + ">():T\n"
		helpers += "export interface Owner<R>{generic<T extends R>():T}\nexport declare const owner:Owner<" + constraint + ">\n"
		helpers += "export declare const genericVar:<T extends " + constraint + ">()=>T\n"
		helpers += "/** @throws {never} */\nexport declare function factory():<T extends " + constraint + ">()=>T\n"
		helpers += "export interface Handler {\n" + bound + "():unknown\n}\nexport interface API{run:Handler}\n/** @throws {never} */\nexport declare function consume(fn:Handler):void\n"
		prefix := "import {generic,owner,genericVar,factory,consume,type Handler,type API} from \"./helpers.js\"\nimport type * as Effect from \"effect/Effect\"\nimport type * as Stream from \"effect/Stream\"\nimport type * as Layer from \"effect/Layer\"\n"
		value := []string{"generic", "owner.generic", "genericVar", "factory()"}[v.source] + "<" + chosen + ">"
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
		want := (v.constraint == 0 || v.constraint == 2 || v.constraint == 3) && v.bound != 2
		if len(errors) > 1 || len(errors) == 1 && errors[0] != "EK0402" || (len(errors) == 1) != want {
			Gap(t, "FuzzInstantiatedDefaultCallbacks", "contract:"+v.name(), "003-failures: %s; %s; key%s got%v want EK0402=%t\n%s", foreignVariableEffectQuote, foreignVariableAdmissionQuote, v.name(), errors, want, Archive(files))
		} else {
			// The key names this one probe, so a pending line for it is stale.
			ExpectPending(t, "FuzzInstantiatedDefaultCallbacks", "contract:"+v.name())
		}
	})
}

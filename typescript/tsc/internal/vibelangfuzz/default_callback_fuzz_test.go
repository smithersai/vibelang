package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const defaultForeignQuote = "| no tag | \x60unknown\x60 |"
const defaultForeignAdmissionQuote = "a type without \x60@throws\x60 admits only \x60never\x60"
const defaultForeignAliasQuote = "\x60const g = f\x60 preserves \x60f\x60's contract"

var defaultForeignSources = []string{"foreign", "never", "effect", "vibe", "alias", "own-instantiation", "constrained-effect", "captured-effect", "method", "intersection-method", "union-method", "primitive-method", "intersection-effect", "captured-constraint", "captured-constraint-chain", "intersection-captured-constraint"}
var defaultForeignBounds = []string{"untagged", "Error", "unknown"}
var defaultForeignSites = []string{"argument", "initializer", "return", "member", "class-field", "inherited"}

type defaultForeignVariant struct{ source, bound, site int }

func (v defaultForeignVariant) name() string {
	return fmt.Sprintf("%s/%s/%s", defaultForeignSources[v.source], defaultForeignBounds[v.bound], defaultForeignSites[v.site])
}
func defaultForeignVariants() ([]defaultForeignVariant, []string) {
	var variants []defaultForeignVariant
	var names []string
	for source := range defaultForeignSources {
		for bound := range defaultForeignBounds {
			for site := range defaultForeignSites {
				v := defaultForeignVariant{source, bound, site}
				variants = append(variants, v)
				names = append(names, v.name())
			}
		}
	}
	return variants, names
}
func TestDefaultForeignCallbacksQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", defaultForeignQuote, defaultForeignAdmissionQuote, defaultForeignAliasQuote)
}
func TestDefaultForeignCallbackKeys(t *testing.T) {
	_, names := defaultForeignVariants()
	if len(names) != 288 {
		t.Fatalf("got%d keys", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzDefaultForeignCallbacks", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatal(p)
		}
	}
}
func FuzzDefaultForeignCallbacks(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", defaultForeignQuote, defaultForeignAdmissionQuote, defaultForeignAliasQuote)
	variants, names := defaultForeignVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		bound := ""
		if v.bound != 0 {
			bound = "/** @throws {" + defaultForeignBounds[v.bound] + "} */\n"
		}
		tag, result := "", "unknown"
		if v.source == 1 {
			tag = "/** @throws {never} */\n"
		}
		if v.source == 2 {
			result = "Effect.Effect<number>"
		}
		helpers := "import type * as Effect from \"effect/Effect\"\n" + tag + "export declare function source():" + result + "\n"
		helpers += "export interface Handler {\n" + bound + "():unknown\n}\nexport interface API {run:Handler}\n/** @throws {never} */\nexport declare function consume(fn:Handler):void\n"
		helpers += "export declare function generic<T>():T\nexport declare function constrained<T extends Effect.Effect<number>>():T\nexport interface Owner<R>{method():R;bounded<T extends R>():T;chain<T extends R,U extends T>():U}\nexport declare const fxOwner:Owner<Effect.Effect<number>>\nexport declare const capturedIntersection:Owner<Effect.Effect<number>> & {marker:true}\nexport declare const owner:Owner<unknown>\n"
		helpers += "export declare const intersectionOwner: {method<T>():T} & {marker:true}\nexport declare const unionOwner: {method<T>():T} | {method<T>():T;marker:true}\nexport declare const intersectionFx: {method<T extends Effect.Effect<number>>():T} & {marker:true}\ndeclare global {interface String {foreignContractMethod<T>():T}}\n"
		prefix := "import {source,consume,generic,constrained,fxOwner,owner,intersectionOwner,unionOwner,intersectionFx,capturedIntersection,type API,type Handler} from \"./helpers.js\"\nimport type * as Effect from \"effect/Effect\"\n"
		value := "source"
		switch v.source {
		case 3:
			prefix += "function local(){return 1}\n"
			value = "local"
		case 4:
			prefix += "const value=source\n"
			value = "value"
		case 5:
			prefix += "const value=generic<Effect.Effect<number>>\n"
			value = "value"
		case 6:
			value = "constrained"
		case 7:
			prefix += "const value=fxOwner.method\n"
			value = "value"
		case 8:
			value = "owner.method"
		case 9:
			value = "intersectionOwner.method"
		case 10:
			value = "unionOwner.method"
		case 11:
			value = "\"value\".foreignContractMethod"
		case 12:
			value = "intersectionFx.method"
		case 13:
			value = "fxOwner.bounded"
		case 14:
			value = "fxOwner.chain"
		case 15:
			value = "capturedIntersection.bounded"
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
		unsafe := v.source == 0 || v.source == 4 || v.source == 5 || v.source == 8 || v.source == 9 || v.source == 10 || v.source == 11
		want := unsafe && v.bound != 2
		if len(errors) > 1 || len(errors) == 1 && errors[0] != "EK0402" || (len(errors) == 1) != want {
			Gap(t, "FuzzDefaultForeignCallbacks", "contract:"+v.name(), "003-failures: %s; %s; key%s got%v want EK0402=%t\n%s", defaultForeignQuote, defaultForeignAdmissionQuote, v.name(), errors, want, Archive(files))
		}
	})
}

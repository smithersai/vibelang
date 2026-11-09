package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const counterfeitEffectTarget = "FuzzCounterfeitEffectReturns"

var counterfeitEffectQuotes = []string{"assignability to `Effect.Effect<any, any, any>`", "A plain function whose return type is wholly one of these Effect subtypes is effectful and may not throw", "A call whose throwing is unknown, such as an unannotated `.ts` function, stays an ordinary call"}

func assertCounterfeitEffectRules(t testing.TB) {
	for _, q := range counterfeitEffectQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("effectful return rule changed: %s", q)
		}
	}
}
func TestCounterfeitEffectReturnsQuoted(t *testing.T) { assertCounterfeitEffectRules(t) }

func counterfeitEffectKeys() []string {
	var keys []string
	for _, shape := range []string{"local", "namespace", "renamed", "nongeneric", "structural", "effect", "stream", "layer"} {
		for _, site := range []string{"plain", "effect", "caught", "wrapped"} {
			for _, contract := range []string{"never", "error", "untagged"} {
				keys = append(keys, shape+":"+site+":"+contract)
			}
		}
	}
	return keys
}
func counterfeitEffectSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	shape, site, contract := parts[0], parts[1], parts[2]
	library := "import type {Effect as ActualEffect,Stream,Layer} from \"effect\"\n"
	value := "Effect<number,never,never>"
	switch shape {
	case "local":
		library += "export interface Effect<A,E,R>{readonly \"~effect/Effect\":unknown}\n"
	case "namespace":
		library += "export namespace Local {export interface Effect<A,E,R>{readonly \"~effect/Effect\":unknown}}\n"
		value = "Local.Effect<number,never,never>"
	case "renamed":
		library += "export interface Program<A,E,R>{readonly \"~effect/Effect\":unknown}\n"
		value = "Program<number,never,never>"
	case "nongeneric":
		library += "export interface Effect{readonly \"~effect/Effect\":unknown}\n"
		value = "Effect"
	case "structural":
		library += "export interface Effect<A,E,R> extends ActualEffect.Effect<A,E,R>{}\n"
	case "effect":
		value = "ActualEffect.Effect<number>"
	case "stream":
		value = "Stream.Stream<number>"
	case "layer":
		value = "Layer.Layer<never>"
	}
	library += "export type Value=" + value + "\n"
	doc := ""
	if contract == "never" {
		doc = "/** @throws {never} */\n"
	}
	if contract == "error" {
		doc = "/** @throws {RangeError} */\n"
	}
	if choice&4 != 0 {
		doc = strings.ReplaceAll(doc, " */", "\n */")
	}
	signature := "():Value"
	if choice&2 != 0 {
		signature = "<T extends Value>():T"
	}
	library += doc + "export declare function make" + signature + "\n"
	library += "export declare function unknownCall():number\n"
	call := "make()"
	prefix := ""
	if choice&1 != 0 {
		call = "(make)()"
	}
	if choice&8 != 0 {
		prefix = "const saved=make\n"
		call = "saved()"
	}
	body := "export const value=" + call
	switch site {
	case "effect":
		body = "export effect function main(){return " + call + "}"
	case "caught":
		body = "export function main(){try{return " + call + "}catch{return undefined}}"
	case "wrapped":
		body = "export const value=Effect.try({try:()=>" + call + ",catch:(error:unknown)=>error})"
	case "home":
		body = "export function main():Value{unknownCall();return {} as Value}"
	}
	genuine := shape == "structural" || shape == "effect" || shape == "stream" || shape == "layer"
	want := 0
	if site == "home" {
		if genuine {
			want = 401
		}
	} else if !genuine && contract != "never" {
		if site == "effect" {
			want = 403
		} else if site == "plain" && contract == "error" {
			want = 401
		}
	}
	return "import {Effect} from \"effect\"\nimport {make,unknownCall} from \"./foreign.js\"\nimport type {Value} from \"./foreign.js\"\n" + prefix + body, library, want
}

func checkCounterfeitEffect(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := counterfeitEffectSource(key, choice)
	project := Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": "{\"type\":\"module\"}"}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":true},\"files\":[\"main.vibe\",\"foreign.d.ts\"]}"}
	result, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var got []int
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		got = append(got, int(d.Code()))
		if !IsEK(d) || int(d.Code()) != want {
			Gap(t, counterfeitEffectTarget, key, "%q: unexpected %s", counterfeitEffectQuotes[0], describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, counterfeitEffectTarget, key, "%q: got %v, want EK%04d", counterfeitEffectQuotes[0], got, want)
	}
}
func TestCounterfeitEffectReturns(t *testing.T) {
	assertCounterfeitEffectRules(t)
	w := NewWorkspace(t)
	for _, key := range counterfeitEffectKeys() {
		t.Run(key, func(t *testing.T) { checkCounterfeitEffect(t, w, key, 0) })
	}
	for _, shape := range []string{"local", "namespace", "renamed", "nongeneric", "structural", "effect", "stream", "layer"} {
		key := shape + ":home:untagged"
		t.Run(key, func(t *testing.T) { checkCounterfeitEffect(t, w, key, 0) })
	}
}
func TestCounterfeitEffectReturnVariants(t *testing.T) {
	assertCounterfeitEffectRules(t)
	w := NewWorkspace(t)
	for _, key := range counterfeitEffectKeys() {
		for _, choice := range []uint8{1, 2, 15} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkCounterfeitEffect(t, w, key, choice) })
		}
	}
}
func FuzzCounterfeitEffectReturns(f *testing.F) {
	startShortBudget(f)
	assertCounterfeitEffectRules(f)
	keys := counterfeitEffectKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkCounterfeitEffect(t, w, key, choice)
	})
}

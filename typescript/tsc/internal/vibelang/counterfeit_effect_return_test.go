package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

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

func TestCounterfeitEffectReturns(t *testing.T) {
	keys := counterfeitEffectKeys()
	for _, shape := range []string{"local", "namespace", "renamed", "nongeneric", "structural", "effect", "stream", "layer"} {
		keys = append(keys, shape+":home:untagged")
	}
	for _, key := range keys {
		for _, choice := range []uint8{0, 1, 2, 15} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) {
				source, library, want := counterfeitEffectSource(key, choice)
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
				var got []int
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() != diagnosticSource {
						t.Errorf("unexpected %s", d.String())
					}
					got = append(got, int(d.Code()))
				}
				if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
					t.Errorf("got %v, want EK%04d (zero means none)", got, want)
				}
			})
		}
	}
}

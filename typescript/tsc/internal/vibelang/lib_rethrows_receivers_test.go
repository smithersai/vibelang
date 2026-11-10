package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

type libRethrowsShape struct {
	name, parameter, call string
	tracked               bool
}

var libRethrowsShapes = []libRethrowsShape{
	{"array-flatMap", "xs:number[]", "xs.flatMap(CB)", true},
	{"array-findIndex", "xs:number[]", "xs.findIndex(CB)", true},
	{"array-findLast", "xs:number[]", "xs.findLast(CB)", true},
	{"array-findLastIndex", "xs:number[]", "xs.findLastIndex(CB)", true},
	{"array-reduceRight", "xs:number[]", "xs.reduceRight(CB,0)", true},
	{"array-toSorted", "xs:number[]", "xs.toSorted(CB)", true},
	{"readonly-array-flatMap", "xs:readonly number[]", "xs.flatMap(CB)", true},
	{"readonly-array-findIndex", "xs:readonly number[]", "xs.findIndex(CB)", true},
	{"readonly-array-findLast", "xs:readonly number[]", "xs.findLast(CB)", true},
	{"readonly-array-findLastIndex", "xs:readonly number[]", "xs.findLastIndex(CB)", true},
	{"readonly-array-reduceRight", "xs:readonly number[]", "xs.reduceRight(CB,0)", true},
	{"readonly-array-toSorted", "xs:readonly number[]", "xs.toSorted(CB)", true},
	{"typed-findIndex", "xs:Uint8Array", "xs.findIndex(CB)", true},
	{"typed-findLast", "xs:Uint8Array", "xs.findLast(CB)", true},
	{"typed-findLastIndex", "xs:Uint8Array", "xs.findLastIndex(CB)", true},
	{"typed-reduceRight", "xs:Uint8Array", "xs.reduceRight(CB,0)", true},
	{"typed-toSorted", "xs:Uint8Array", "xs.toSorted(CB)", true},
	{"bigint-findIndex", "xs:BigInt64Array", "xs.findIndex(CB)", true},
	{"bigint-findLast", "xs:BigInt64Array", "xs.findLast(CB)", true},
	{"bigint-findLastIndex", "xs:BigInt64Array", "xs.findLastIndex(CB)", true},
	{"bigint-reduceRight", "xs:BigInt64Array", "xs.reduceRight(CB,0n)", true},
	{"bigint-toSorted", "xs:BigInt64Array", "xs.toSorted(CB)", true},
	{"array-forEach", "xs:number[]", "xs.forEach(CB)", true},
	{"readonly-array-map", "xs:readonly number[]", "xs.map(CB)", true},
	{"array-from", "xs:number[]", "Array.from(xs,CB)", true},
	{"map-forEach", "m:Map<string,number>", "m.forEach(CB)", true},
	{"readonly-map-forEach", "m:ReadonlyMap<string,number>", "m.forEach(CB)", true},
	{"set-forEach", "s:Set<number>", "s.forEach(CB)", true},
	{"readonly-set-forEach", "s:ReadonlySet<number>", "s.forEach(CB)", true},
	{"typed-map", "t:Float64Array", "t.map(CB)", true},
	{"typed-forEach", "t:Uint8Array", "t.forEach(CB)", true},
	{"typed-filter", "t:Int16Array", "t.filter(CB)", true},
	{"typed-find", "t:Uint32Array", "t.find(CB)", true},
	{"typed-some", "t:Uint8ClampedArray", "t.some(CB)", true},
	{"typed-every", "t:Int8Array", "t.every(CB)", true},
	{"typed-sort", "t:Int32Array", "t.sort(CB)", true},
	{"typed-reduce", "t:Float32Array", "t.reduce(CB,0)", true},
	{"typed-from", "xs:number[]", "Uint8Array.from(xs,CB)", true},
}

func libRethrowsKeys() []string {
	var result []string
	for _, shape := range libRethrowsShapes {
		for _, site := range []string{"plain", "effect", "caught", "wrapped"} {
			// A method without a shipped rethrows has its own thrown type in
			// effect code, and a wrapper thunk is checked by its own rules.
			if !shape.tracked && (site == "effect" || site == "wrapped") {
				continue
			}
			result = append(result, shape.name+":"+site)
		}
	}
	return result
}

// libRethrowsSource passes a foreign callback to one lib method. choice bit 1
// parenthesizes the callback, bit 2 passes a callback that throws never and
// bit 4 passes an inline arrow that calls the throwing function.
func libRethrowsSource(key string, choice uint8) (string, string, int) {
	name, site, _ := strings.Cut(key, ":")
	var shape libRethrowsShape
	for _, candidate := range libRethrowsShapes {
		if candidate.name == name {
			shape = candidate
		}
	}
	callback := "risky"
	if choice&2 != 0 {
		callback = "safe"
	}
	inline := choice&4 != 0
	if inline {
		callback = "()=>" + callback + "()"
	}
	if choice&1 != 0 {
		callback = "(" + callback + ")"
	}
	call := strings.Replace(shape.call, "CB", callback, 1)
	library := "/** @throws {RangeError} */\nexport declare function risky(...args:any[]):any\n/** @throws {never} */\nexport declare function safe(...args:any[]):any\n"
	source := "/// <reference lib=\"esnext\" />\nimport {Effect} from \"effect\"\nimport {risky,safe} from \"./foreign.js\"\n"
	body := ""
	switch site {
	case "plain":
		body = "export function main(" + shape.parameter + "){return " + call + "}"
	case "effect":
		body = "export effect function main(" + shape.parameter + "){return " + call + "}"
	case "caught":
		body = "export function main(" + shape.parameter + "){try{return " + call + "}catch{return 0}}"
	case "wrapped":
		body = "export function main(" + shape.parameter + "){return Effect.try({try:()=>" + call + ",catch:(e:unknown)=>e})}"
	}
	want := 0
	switch {
	case choice&2 != 0:
	case shape.tracked && site == "plain":
		want = 401
	case shape.tracked && site == "effect":
		want = 403
	case shape.tracked:
	case inline:
		want = 401
	default:
		want = 402
	}
	return source + body, library, want
}

func TestLibRethrowsReceivers(t *testing.T) {
	for _, key := range libRethrowsKeys() {
		for _, choice := range []uint8{0, 1, 2, 4, 6} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) {
				source, library, want := libRethrowsSource(key, choice)
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
				var got []int
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() != diagnosticSource {
						t.Errorf("unexpected: %s", d.String())
					}
					got = append(got, int(d.Code()))
				}
				if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
					t.Errorf("got %v, want EK%04d (zero means none)\n%s", got, want, source)
				}
			})
		}
	}
}

// The receiver decides the shipped annotation, not the method name alone.
func TestShippedRethrowsParameterReceivers(t *testing.T) {
	for receiver := range shippedRethrowsCollections {
		if shippedRethrowsArrays[receiver] {
			t.Errorf("%s is listed as both an array and a forEach-only collection", receiver)
		}
	}
	for _, receiver := range []string{"NodeList", "URLSearchParams", "Headers", "FormData", "IteratorObject", "DOMTokenList"} {
		if shippedRethrowsArrays[receiver] || shippedRethrowsCollections[receiver] {
			t.Errorf("%s stores or lazily runs its callback; its parameter admits only never", receiver)
		}
	}
}

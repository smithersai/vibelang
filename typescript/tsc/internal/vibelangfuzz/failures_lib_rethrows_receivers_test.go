package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const libRethrowsTarget = "FuzzLibRethrowsReceivers"

var libRethrowsQuotes = []string{
	"has a `@rethrows` parameter given a callback known to throw",
	"Every other callback parameter of any function, Effect's and the globals' alike, `LazyArg` included, is a function type with no `@throws`, so it admits only non-throwing functions",
}

func assertLibRethrowsRules(t testing.TB) {
	if !strings.Contains(SpecText(failuresChapter), libRethrowsQuotes[0]) {
		t.Fatalf("rethrows rule changed: %s", libRethrowsQuotes[0])
	}
	if !strings.Contains(SpecText("900-appendices.md"), libRethrowsQuotes[1]) {
		t.Fatalf("Appendix E changed: %s", libRethrowsQuotes[1])
	}
}
func TestLibRethrowsReceiversQuoted(t *testing.T) { assertLibRethrowsRules(t) }

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
	{"bigint-forEach", "t:BigInt64Array", "t.forEach(CB)", true},
	{"url-params-forEach", "p:URLSearchParams", "p.forEach(CB)", false},
	{"node-list-forEach", "n:NodeList", "n.forEach(CB)", false},
	{"headers-forEach", "h:Headers", "h.forEach(CB)", false},
	{"iterator-map", "it:IteratorObject<number,undefined,unknown>", "it.map(CB)", false},
	{"iterator-forEach", "it:IteratorObject<number,undefined,unknown>", "it.forEach(CB)", false},
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
	source := "import {Effect} from \"effect\"\nimport {risky,safe} from \"./foreign.js\"\n"
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

func checkLibRethrows(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := libRethrowsSource(key, choice)
	project := Project{Files: map[string]string{"main.vibe": source, "foreign.d.ts": library, "package.json": "{\"type\":\"module\"}"}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"esnext\",\"dom\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":true},\"files\":[\"main.vibe\",\"foreign.d.ts\"]}"}
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
			Gap(t, libRethrowsTarget, key, "%q: unexpected %s", libRethrowsQuotes[1], describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, libRethrowsTarget, key, "%q: got %v, want EK%04d", libRethrowsQuotes[0], got, want)
	}
}

func TestLibRethrowsReceivers(t *testing.T) {
	assertLibRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range libRethrowsKeys() {
		t.Run(key, func(t *testing.T) { checkLibRethrows(t, w, key, 0) })
	}
}
func TestLibRethrowsReceiversVariants(t *testing.T) {
	assertLibRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range libRethrowsKeys() {
		for _, choice := range []uint8{1, 2, 4, 6} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkLibRethrows(t, w, key, choice) })
		}
	}
}
func FuzzLibRethrowsReceivers(f *testing.F) {
	startShortBudget(f)
	assertLibRethrowsRules(f)
	keys := libRethrowsKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkLibRethrows(t, w, key, choice)
	})
}

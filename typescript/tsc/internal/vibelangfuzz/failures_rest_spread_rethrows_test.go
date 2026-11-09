package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const restSpreadRethrowsTarget = "FuzzRestSpreadRethrows"

var restSpreadRethrowsQuotes = []string{"has a `@rethrows` parameter given a callback known to throw", "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |"}

func assertRestSpreadRethrowsRules(t testing.TB) {
	for _, q := range restSpreadRethrowsQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("rethrows rule changed: %s", q)
		}
	}
}
func TestRestSpreadRethrowsQuoted(t *testing.T) { assertRestSpreadRethrowsRules(t) }

func restSpreadRethrowsKeys() []string {
	var result []string
	for _, shape := range []string{"array", "array-tail", "array-head", "two-arrays", "leading-fixed", "rest-tuple", "method", "constructor", "asserted", "sibling-rest"} {
		for _, site := range []string{"plain", "effect", "caught", "wrapped"} {
			result = append(result, shape+":"+site)
		}
	}
	return result
}

// restSpreadRethrowsSource builds one call that spreads callbacks of unknown
// count. choice bit 1 makes the array readonly, bit 2 gives the callbacks a
// never contract, bit 4 parenthesizes the spread operand, bit 8 types the
// elements with a call-signature interface and bit 16 writes the tags on
// separate lines.
func restSpreadRethrowsSource(key string, choice uint8) (string, string, int) {
	parts := strings.Split(key, ":")
	shape, site := parts[0], parts[1]
	contract := "RangeError"
	if choice&2 != 0 {
		contract = "never"
	}
	element := "typeof risky"
	if choice&8 != 0 {
		element = "Risky"
	}
	array := "(" + element + ")[]"
	if choice&1 != 0 {
		array = "readonly " + array
	}
	doc := "/** @throws {never} @rethrows callbacks */\n"
	if choice&16 != 0 {
		doc = "/**\n * @throws {never}\n * @rethrows callbacks\n */\n"
	}
	library := "/** @throws {never} */ export declare function safe():number\n/** @throws {" + contract + "} */ export declare function risky():number\n" +
		"export interface Risky {\n/** @throws {" + contract + "} */\n():number}\nexport interface Broad {\n/** @throws {unknown} */\n():number}\n"
	operand := "callbacks"
	if choice&4 != 0 {
		operand = "(callbacks)"
	}
	prefix := "const callbacks:" + array + "=[risky];"
	params := "...callbacks:(()=>number)[]"
	call := "many(..." + operand + ")"
	names := "many,risky,safe"
	tracked := true
	switch shape {
	case "array-tail":
		call = "many(..." + operand + ",safe)"
	case "array-head":
		call = "many(safe,..." + operand + ")"
	case "two-arrays":
		prefix += "const safes:(typeof safe)[]=[safe];"
		call = "many(...safes,..." + operand + ")"
	case "leading-fixed":
		params = "first:number," + params
		call = "many(1,..." + operand + ")"
	case "rest-tuple":
		prefix = "const callbacks:[typeof safe,...(" + element + ")[]]=[safe,risky];"
		if choice&1 != 0 {
			prefix = "const callbacks:readonly [typeof safe,...(" + element + ")[]]=[safe,risky];"
		}
	case "method":
		library += "export interface Host {\n" + doc + "many(" + params + "):number}\n/** @throws {never} */ export declare const host:Host\n"
		call = "host.many(..." + operand + ")"
		names = "host,risky,safe"
	case "constructor":
		library += "export declare class Many {\n" + doc + "constructor(" + params + ")}\n"
		call = "new Many(..." + operand + ")"
		names = "Many,risky,safe"
	case "asserted":
		prefix = ""
		call = "many(...([risky] as " + array + "))"
	case "sibling-rest":
		doc = strings.Replace(doc, "@rethrows callbacks", "@rethrows first", 1)
		params = "first:()=>number,...callbacks:Broad[]"
		call = "many(safe,..." + operand + ")"
		tracked = false
	}
	if shape != "method" && shape != "constructor" {
		library += doc + "export declare function many(" + params + "):number\n"
	}
	source := "import {Effect} from \"effect\"\nimport {" + names + "} from \"./foreign.js\"\n"
	if choice&8 != 0 {
		source += "import type {Risky} from \"./foreign.js\"\n"
	}
	want := 0
	body := ""
	switch site {
	case "plain":
		body = "export function main(){" + prefix + "return " + call + "}"
		if tracked && contract != "never" {
			want = 401
		}
	case "effect":
		body = "export effect function main(){" + prefix + "return " + call + "}"
		if tracked && contract != "never" {
			want = 403
		}
	case "caught":
		body = "export function main(){" + prefix + "try{return " + call + "}catch{return 0}}"
	case "wrapped":
		body = "export const value=Effect.try({try:()=>{" + prefix + "return " + call + "},catch:(e:unknown)=>e})"
	}
	return source + body, library, want
}

func checkRestSpreadRethrows(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	source, library, want := restSpreadRethrowsSource(key, choice)
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
			Gap(t, restSpreadRethrowsTarget, key, "%q: unexpected %s", restSpreadRethrowsQuotes[1], describe(d))
		}
	}
	if want == 0 && len(got) != 0 || want != 0 && (len(got) != 1 || got[0] != want) {
		Gap(t, restSpreadRethrowsTarget, key, "%q: got %v, want EK%04d", restSpreadRethrowsQuotes[0], got, want)
	}
}

func TestRestSpreadRethrows(t *testing.T) {
	assertRestSpreadRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range restSpreadRethrowsKeys() {
		t.Run(key, func(t *testing.T) { checkRestSpreadRethrows(t, w, key, 0) })
	}
}
func TestRestSpreadRethrowsVariants(t *testing.T) {
	assertRestSpreadRethrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range restSpreadRethrowsKeys() {
		for _, choice := range []uint8{1, 2, 4, 8, 16, 29} {
			t.Run(fmt.Sprintf("%s/%d", key, choice), func(t *testing.T) { checkRestSpreadRethrows(t, w, key, choice) })
		}
	}
}
func FuzzRestSpreadRethrows(f *testing.F) {
	startShortBudget(f)
	assertRestSpreadRethrowsRules(f)
	keys := restSpreadRethrowsKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkRestSpreadRethrows(t, w, key, choice)
	})
}

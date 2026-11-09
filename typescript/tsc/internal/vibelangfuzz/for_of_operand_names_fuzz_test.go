package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const forOfOperandNamesTarget = "FuzzForOfOperandNames"

func TestForOfOperandNamesQuoted(t *testing.T) { forOfOperandNamesChapter(t) }
func forOfOperandNamesChapter(t testing.TB) {
	t.Helper()
	forTryOperandsChapter(t)
	chapterSays(t, "002-running.md", "Native \x60for...of\x60 and \x60for await\x60 keep TypeScript's protocol checks and JavaScript meaning")
	chapterSays(t, "007-tooling.md", "Native lexical, syntax and static errors keep their \x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types.")
}

// A for try head, a for...of head with an is binding and a do expression in a
// loop head hold the operand in a generated constant. The oracle is the native TypeScript loop over the same
// operand: its diagnostic for an unknown or nullable operand names the written
// operand, or calls it an object. A native loop with an is binding reports
// exactly that diagnostic. A for try reports EK2004 once, and any TypeScript
// operand diagnostic beside it is the native one, never one that names the
// generated constant.
func FuzzForOfOperandNames(f *testing.F) {
	startShortBudget(f)
	forOfOperandNamesChapter(f)
	var keys []string
	for _, loop := range []string{"for-try", "is-head"} {
		for _, value := range []string{"unknown", "undefined", "null", "both"} {
			for _, shape := range []string{"name", "property", "call", "parens", "element", "do"} {
				keys = append(keys, loop+":"+value+":"+shape)
			}
		}
	}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	f.Add("for-try:unknown:name", uint8(3))
	f.Add("is-head:undefined:property", uint8(3))
	family := []int32{2531, 2532, 2533, 2571, 18046, 18047, 18048, 18049}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(flags)%len(keys)]
		}
		parts := strings.Split(key, ":")
		base := "number[][]"
		if parts[0] == "for-try" {
			base = "Stream.Stream<number>"
		}
		value := map[string]string{"unknown": "unknown", "undefined": base + " | undefined", "null": base + " | null", "both": base + " | null | undefined"}[parts[1]]
		operand := map[string]string{"name": "rows", "property": "holder.rows", "call": "load()", "parens": "(rows)", "element": "holder[\"rows\"]", "do": "do { load() }"}[parts[2]]
		// A do expression is an expression, not a name: its native twin is a call.
		native := operand
		if parts[2] == "do" {
			native = "(() => load())()"
		}
		binding := "const"
		if flags&1 != 0 {
			binding = "let"
		}
		if flags&2 != 0 {
			operand, native = "/* operand */ "+operand, "/* operand */ "+native
		}
		prefix := "import { Stream } from \"effect\"\ndeclare const holder: { rows: " + value + " }\ndeclare function load(): " + value + "\ndeclare const probe: unknown\n"
		source := fmt.Sprintf("export function check(rows: %s) { for (%s [row = (probe is [let first]) ? first : 0] of %s) { void row } }", value, binding, operand)
		twin := fmt.Sprintf("export function check(rows: %s) { for (%s [row = 0] of %s) { void row } }", value, binding, native)
		if parts[0] == "for-try" {
			source = fmt.Sprintf("export effect function check(rows: %s) { for try (%s row of %s) { void row } }", value, binding, operand)
			twin = fmt.Sprintf("export async function check(rows: %s) { for await (%s row of %s) { void row } }", value, binding, native)
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": prefix + source, "twin.ts": prefix + twin}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		operandErrors := func(name string) (native []string, rejections int) {
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError || d.File() == nil || !strings.HasSuffix(string(d.File().FileName()), "/"+name) {
					continue
				}
				if IsEK(d) {
					if d.Code() == 2004 {
						rejections++
					}
					continue
				}
				if slices.Contains(family, d.Code()) {
					native = append(native, fmt.Sprintf("TS%d %s", d.Code(), d.String()))
				}
			}
			return native, rejections
		}
		got, rejections := operandErrors("main.vibe")
		want, _ := operandErrors("twin.ts")
		if len(want) != 1 {
			t.Fatalf("native control changed: %v\n%s", want, twin)
		}
		if parts[0] == "for-try" {
			if rejections != 1 {
				Gap(t, forOfOperandNamesTarget, "operand:"+key, "%s: EK2004 count %d\n%s", forTryOperandQuote, rejections, source)
			}
			for _, d := range got {
				if d != want[0] {
					Gap(t, forOfOperandNamesTarget, "operand:"+key, "native static errors keep their TS codes, as in TypeScript: got %v, the native loop reports %v\n%s", got, want, source)
				}
			}
		} else if !slices.Equal(got, want) {
			Gap(t, forOfOperandNamesTarget, "operand:"+key, "native for...of keeps TypeScript's checks: got %v, the loop without an is binding reports %v\n%s", got, want, source)
		}
		ExpectPending(t, forOfOperandNamesTarget, "operand:"+key)
		ExpectPending(t, forOfOperandNamesTarget, specCorpusKey(t))
	})
}

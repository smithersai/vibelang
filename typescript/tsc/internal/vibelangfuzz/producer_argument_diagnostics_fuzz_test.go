package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const producerArgumentDiagnosticsQuote = "Native lexical, syntax and static errors keep their " + "`TS`" + " codes, as in TypeScript, including independent errors in embedded expressions and types."

func TestProducerArgumentDiagnosticsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", producerArgumentDiagnosticsQuote)
	chapterSays(t, "002-running.md", "A plain "+"`function*`"+" stays a JavaScript generator.")
}

type producerArgumentDiagnosticRow struct{ key, body string }

var producerArgumentDiagnosticBodies = []producerArgumentDiagnosticRow{
	{"empty-const", "const\nconst users = 1"},
	{"empty-class-parameters", "class C<> {}"},
	{"empty-interface-parameters", "interface C<> {}"},
	{"duplicate-binding", "const n=1;const n=2"},
	{"missing-name", "void missing"},
	{"wrong-type", "const n:number=\"\""},
	{"parameter-property", "function inner(public n:number){}"},
	{"valued-return", "return 1"},
	{"delegation", "yield* [1]"},
	{"valid", "yield 1"},
}

func FuzzProducerArgumentNativeDiagnostics(f *testing.F) {
	startShortBudget(f)
	apis := []producerArgumentDiagnosticRow{
		{"custom", "take(ARG)"},
		{"gen", "Effect.gen(ARG)"},
		{"fn", "Effect.fnUntraced(ARG)"},
		{"named-fn", "Effect.fn(\"read\")(ARG)"},
	}
	type profile struct{ key, call, home, body, parameters string }
	var rows []profile
	for _, api := range apis {
		for _, home := range []string{"inline", "named"} {
			for _, body := range producerArgumentDiagnosticBodies {
				rows = append(rows, profile{api.key + ":" + home + ":" + body.key, api.body, home, body.body, ""})
			}
		}
		for _, home := range []string{"inline", "named"} {
			rows = append(rows, profile{api.key + ":" + home + ":parameter-default", api.body, home, "yield 1", "n:number=\"\""})
		}
	}
	for _, row := range rows {
		f.Add(row.key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestProducerArgumentDiagnosticsQuoted(t)
		index := slices.IndexFunc(rows, func(row profile) bool { return row.key == key })
		if index < 0 {
			index = 0
			for _, b := range []byte(key) {
				index = (index*31 + int(b)) % len(rows)
			}
		}
		row := rows[index]
		flags %= 4
		body := row.body
		if flags&1 != 0 {
			body = "/* independent body */" + body
		}
		if flags&2 != 0 {
			body = "{" + body + "}"
		}
		pre := "import {Effect} from \"effect\";declare function take(body:()=>Generator<number,void,unknown>):void;"
		base := pre + "const producer=effect function*(" + row.parameters + "){" + body + "};void producer;"
		producer := "effect function*(" + row.parameters + "){" + body + "}"
		source := pre + strings.ReplaceAll(row.call, "ARG", producer)
		if row.home == "named" {
			source = pre + "effect function* producer(" + row.parameters + "){" + body + "};" + strings.ReplaceAll(row.call, "ARG", "producer")
		}
		codes := func(source string) []string {
			compiled, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer compiled.Remove()
			var native []string
			for _, code := range r3Errors(compiled.Diagnostics) {
				if strings.HasPrefix(code, "TS") || code == "EK1002" {
					native = append(native, code)
				}
			}
			return native
		}
		// The quoted native rule requires the same TS errors with or without the
		// incompatible API. The API adds its own EK1002, not ownership of the body.
		want := append(codes(base), "EK1002")
		slices.Sort(want)
		got := codes(source)
		slices.Sort(got)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzProducerArgumentNativeDiagnostics", fmt.Sprintf("%s:%d", row.key, flags), "independent body errors must survive the API mismatch: want %v got %v\n%s", want, got, source)
		}
	})
}

package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const catchResultOperandQuote = "| `try e` where `e` is not an Effect. A call that may throw, and a Promise, must first be wrapped with `Effect.try`, `tryPromise` or `promise` |"
const catchResultRunsQuote = "| `e catch (err) => y` | one Effect, handling its failure |"
const catchResultValueQuote = "| an arrow or `function` expression | plain function | what the function returns |"
const catchResultPromiseQuote = "| a plain handler whose result type is a Promise or thenable"
const catchResultEffectQuote = "| effect function | `7` |"
const catchResultUnknownQuote = "`never` and `any` pass this test, `never` as the success of an Effect that only fails; `unknown` does not, as TypeScript doesn't assign it to `Effect.Effect<any, any, any>`"

func TestCatchResultOperandQuoted(t *testing.T) {
	chapter := SpecText("002-running.md")
	for _, quote := range []string{catchResultRunsQuote, catchResultOperandQuote, catchResultValueQuote, catchResultEffectQuote, catchResultPromiseQuote, catchResultUnknownQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("stale catch result operand quote: %s", quote)
		}
	}
}

type catchResultOperandCase struct {
	key, typ string
	effect   bool
}

var catchResultOperandCases = []catchResultOperandCase{
	{"unknown", "unknown", false}, {"unknown-success", "unknown", false},
	{"native-try-unknown", "unknown", false}, {"native-try-any", "any", true}, {"string", "string", false},
	{"number", "number", false}, {"object", "{ value: number }", false},
	{"error", "Error", false}, {"promise", "Promise<number>", false},
	{"mixed", "E.Effect<number> | string", false},
	{"effect", "E.Effect<number>", true}, {"any", "any", true},
	{"never", "never", true}, {"tagged-error", "Failure", true},
}
var catchResultOperandForms = []string{"arrow", "block", "function", "effect"}

// Catch evaluates the head and gives either its success or the handler's value.
// Keep the unchecked JSON.parse success separate from an unknown success.
func catchResultOperandSource(c catchResultOperandCase, form string, flags uint8) (string, string) {
	handler := "(e) => e"
	switch form {
	case "block":
		handler = "(e) => { return e }"
	case "function":
		handler = "function (e) { return e }"
	case "effect":
		handler = "effect (e) => e"
	}
	head := "failing"
	success := "never"
	if c.key == "unknown-success" {
		success = "unknown"
	}
	if c.key == "native-try-unknown" {
		head = "E.try({ try: () => copy(\"{\"), catch: e => e })"
	}
	if c.key == "native-try-any" {
		head = "E.try({ try: () => JSON.parse(\"{\"), catch: e => e })"
	}
	caught := "(" + head + " catch " + handler + ")"
	shape := flags & 15
	body := "return try " + caught
	switch shape % 3 {
	case 1:
		body = "const caught = " + caught + "; return try caught"
	case 2:
		body = "const caught: " + c.typ + " = " + caught + "; return try caught"
	}
	declaration := "export effect function run() { " + body + " }"
	switch (shape / 3) % 3 {
	case 1:
		declaration = "export const run = effect () => { " + body + " }"
	case 2:
		declaration = "export class Runner { effect run() { " + body + " } }"
	}
	ext := "main.vibe"
	if flags&16 != 0 {
		ext = "main.vibex"
	}
	return ext, "import { Effect as E, Data } from 'effect'; class Failure extends Data.TaggedError('Failure') {}\ndeclare const failing: E.Effect<" + success + ", " + c.typ + ">; declare const copy: (text: string) => unknown;\n" + declaration
}

func checkCatchResultOperand(t *testing.T, w *Workspace, c catchResultOperandCase, form string, flags uint8) {
	t.Helper()
	TestCatchResultOperandQuoted(t)
	filename, source := catchResultOperandSource(c, form, flags)
	config := strings.Replace(DefaultConfig, "\"strict\": true,", "\"strict\": true, \"jsx\": \"preserve\",", 1)
	config = strings.TrimSuffix(config, "\n}") + fmt.Sprintf(",\n \"files\": [%q]\n}", filename)
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{filename: source}, Config: config})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	codeFor := func(quote string) string {
		for line := range strings.Lines(SpecText("002-running.md")) {
			if strings.Contains(line, quote) {
				codes := ekCode.FindAllString(line, -1)
				if len(codes) != 1 {
					t.Fatalf("operand rule needs one diagnostic: %s", line)
				}
				return codes[0]
			}
		}
		t.Fatalf("missing diagnostic row: %s", quote)
		return ""
	}
	var expected []string
	if !c.effect {
		expected = append(expected, codeFor(catchResultOperandQuote))
	}
	if c.key == "promise" && form != "effect" {
		expected = append(expected, codeFor(catchResultPromiseQuote))
	}
	slices.Sort(expected)
	want := strings.Join(expected, " ")
	key := form + "/" + c.key + "/" + []string{"direct", "inferred", "annotated"}[int(flags&15)%3]
	errors := r3Errors(r.Diagnostics)
	slices.Sort(errors)
	got := strings.Join(errors, " ")
	if got != want {
		Gap(t, "FuzzCatchResultOperand", key, "catch gives its recovered value, which must independently pass the try operand test: want %q, got %q\n%s\n%v", want, got, source, r.Diagnostics)
	}
	ExpectPending(t, "FuzzCatchResultOperand", key)
	if _, name, ok := strings.Cut(t.Name(), "FuzzCatchResultOperand/"); ok && !strings.HasPrefix(name, "seed#") {
		ExpectPending(t, "FuzzCatchResultOperand", "corpus:"+name)
	}
}

func TestCatchResultOperandMatrix(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range catchResultOperandCases {
		for _, form := range catchResultOperandForms {
			for _, ext := range []uint8{0, 16} {
				for flags := uint8(0); flags < 9; flags++ {
					if testing.Short() && (flags != 1 || ext != 0 || form != "arrow") {
						continue
					}
					t.Run(fmt.Sprintf("%s/%s/%d", form, c.key, flags+ext), func(t *testing.T) {
						checkCatchResultOperand(t, w, c, form, flags+ext)
					})
				}
			}
		}
	}
}

func FuzzCatchResultOperand(f *testing.F) {
	startShortBudget(f)
	for _, c := range catchResultOperandCases {
		for i, form := range catchResultOperandForms {
			for use := uint8(0); use < 3; use++ {
				flags := uint8(i%3)*3 + use
				f.Add(form+"/"+c.key, flags)
				if !testing.Short() {
					f.Add(form+"/"+c.key, flags|16)
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		formKey, typeKey, _ := strings.Cut(key, "/")
		form, c := catchResultOperandForms[int(flags)%len(catchResultOperandForms)], catchResultOperandCases[int(flags)%len(catchResultOperandCases)]
		for _, candidate := range catchResultOperandForms {
			if candidate == formKey {
				form = candidate
			}
		}
		for _, candidate := range catchResultOperandCases {
			if candidate.key == typeKey {
				c = candidate
			}
		}
		checkCatchResultOperand(t, w, c, form, flags)
	})
}

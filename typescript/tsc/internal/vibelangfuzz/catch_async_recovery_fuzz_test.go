package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const catchAsyncRecoveryQuote = "an `async` arrow or function expression"
const catchAsyncDiagnosticQuote = "Use an already assigned specific diagnostic for the same rejection; preserve independent native errors."

func TestCatchAsyncRecoveryQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", catchAsyncRecoveryQuote)
	chapterSays(t, "../vips/0034-compiler-and-tooling.md", catchAsyncDiagnosticQuote)
}

// A rejected native handler keeps its written contracts and body diagnostics.
// Its generated Effect callback supplies no source return contract.
func FuzzCatchAsyncRecovery(f *testing.F) {
	startShortBudget(f)
	sites := []string{"arrow", "block", "grouped", "function"}
	variants := []string{"inferred", "annotated", "return-error", "body-error", "nested-error", "record-error", "call-error"}
	keys := []string{}
	for _, site := range sites {
		for _, variant := range variants {
			key := site + "/" + variant
			keys = append(keys, key)
			f.Add([]byte(key), uint8(7))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte, value uint8) {
		TestCatchAsyncRecoveryQuoted(t)
		i, _ := keyedChoice(keys, data)
		site, variant, _ := strings.Cut(keys[i], "/")
		annotation, body := "", ""
		result := fmt.Sprint(value)
		want := []string{"EK0509"}
		switch variant {
		case "annotated":
			annotation = ": Promise<number>"
		case "return-error":
			annotation = ": Promise<string>"
			want = append(want, "TS2322")
		case "body-error":
			body = "const bad: string = 7; void bad; "
			want = append(want, "TS2322")
		case "nested-error":
			body = "const bad = (): { x: number, y: number } => ({}); void bad; "
			want = append(want, "TS2739")
		case "record-error":
			annotation = ": Promise<{ x: number, y: number }>"
			result = "({})"
			want = append(want, "TS2739")
		case "call-error":
			body = "function use(x: string) { return x }; use(7); "
			want = append(want, "TS2345")
		}
		statement := "{ " + body + "return " + result + " }"
		handler := "async (e: string)" + annotation + " => " + statement
		if site == "arrow" && body == "" {
			handler = "async (e: string)" + annotation + " => " + result
		}
		if site == "grouped" {
			handler = "(" + handler + ")"
		}
		if site == "function" {
			handler = "async function (e: string)" + annotation + " " + statement
		}
		source := "export effect function recover() { return Effect.fail(\"bad\") catch " + handler + " }"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzCatchAsyncRecovery", keys[i], "%s; want %v, got %v\n%s", catchAsyncDiagnosticQuote, want, got, source)
		}
	})
}

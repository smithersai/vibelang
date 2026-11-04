package vibelangfuzz

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// docs/design/vips/0038-effect-lint-built-in.md#81e3ccaf6abbb10b
// docs/design/vips/0038-effect-lint-built-in.md#5e2640df1640bef7
// VIP-38: fixed extractor arity uses the required-to-total interval.
const optionalExtractorTarget = "FuzzVIP38OptionalExtractorArgs"

var optionalExtractorKeys = []string{
	"none:optional:1", "none:optional:2", "some:optional:1", "some:optional:2",
	"none:required:0", "some:required:0", "some:required:1",
}
var optionalExtractorQuotes = []string{
	"required positions through total positions, counting every elision slot and counting optional elements only in the maximum",
	"For example, `Option.None(1?)` admits its empty extracted list and is not warned.",
}

func TestVIP38OptionalExtractorQuoted(t *testing.T) {
	text := SpecText("004-match.md")
	for _, quote := range optionalExtractorQuotes {
		if !strings.Contains(text, quote) {
			t.Fatalf("VIP-38 no longer says %q", quote)
		}
	}
}

// Keyed mutations vary literal values, separators, required/optional slots and
// zero/one/two positions; optional slots count only toward the maximum arity.
func FuzzVIP38OptionalExtractorArgs(f *testing.F) {
	startShortBudget(f)
	for _, key := range optionalExtractorKeys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestVIP38OptionalExtractorQuoted(t)
		key, tail, _ := strings.Cut(string(data), "|")
		if !slices.Contains(optionalExtractorKeys, key) {
			if len(data) == 0 {
				return
			}
			key = optionalExtractorKeys[int(data[0])%len(optionalExtractorKeys)]
			tail = string(data)
		}
		parts := strings.Split(key, ":")
		count, err := strconv.Atoi(parts[2])
		if err != nil {
			t.Fatal(err)
		}
		optional := parts[1] == "optional"
		extracts, matcher := 0, "None"
		if parts[0] == "some" {
			extracts, matcher = 1, "Some"
		}
		literal := 1
		if len(tail) > 0 {
			literal = int(tail[0] % 4)
		}
		arguments := make([]string, count)
		for i := range arguments {
			arguments[i] = strconv.Itoa(literal)
			if optional {
				arguments[i] += "?"
			}
		}
		separator := ", "
		if len(tail) > 1 && tail[1]&1 != 0 {
			separator = ",\n"
		}
		source := fmt.Sprintf("import * as Option from \"effect/Option\";\nexport function probe(value: Option.Option<number>): number { return match (value) { when Option.%s(%s): 1; default: 0; } }\n", matcher, strings.Join(arguments, separator))
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []string
		warnings := 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 703 {
				warnings++
				if d.Category() != diagnostics.CategoryWarning {
					t.Fatalf("EK0703 must be a warning, got %v", d.Category())
				}
			} else if d.Category() == diagnostics.CategoryError {
				errors = append(errors, specDiagnosticText(d))
			}
		}
		required := count
		if optional {
			required = 0
		}
		want := 0
		if extracts < required || extracts > count {
			want = 1
		}
		if len(errors) != 0 || warnings != want {
			Gap(t, optionalExtractorTarget, key, "stage=parse/check VIP-38 optional arity: want EK0703=%d and no errors, got warnings=%d errors=%v\n%s", want, warnings, errors, source)
		}
		ExpectPending(t, optionalExtractorTarget, key)
		ExpectPending(t, optionalExtractorTarget, specCorpusKey(t))
	})
}

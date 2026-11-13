package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"slices"
	"strings"
	"testing"
)

const rejectedConstructorHeaderQuote = "A member gets one diagnostic: the first row below that names it."

func rejectedConstructorHeadersChapter(t testing.TB) {
	t.Helper()
	data, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), rejectedConstructorHeaderQuote) {
		t.Fatalf("chapter 5 no longer says %q", rejectedConstructorHeaderQuote)
	}
}
func TestRejectedConstructorFieldHeadersQuoted(t *testing.T) { rejectedConstructorHeadersChapter(t) }

// A service header's own rejection replaces the synthetic class-field-name
// error. Native errors in types, initializers and nested classes remain.
func FuzzRejectedConstructorFieldHeaders(f *testing.F) {
	startShortBudget(f)
	rejectedConstructorHeadersChapter(f)
	data, err := os.ReadFile("testdata/rejected-constructor-field-headers.json")
	if err != nil {
		f.Fatal(err)
	}
	var cases []struct {
		Key, Source string
		Codes       []string
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, tc := range cases {
		for noise := byte(0); noise < 4; noise++ {
			f.Add(append([]byte(tc.Key+"\x00"), noise))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		selected := 0
		if len(data) > 0 {
			selected = int(data[0]) % len(cases)
		}
		parts := strings.SplitN(string(data), "\x00", 2)
		for i, tc := range cases {
			if parts[0] == tc.Key {
				selected = i
				break
			}
		}
		tc := cases[selected]
		source := tc.Source
		var noise byte
		if len(parts) == 2 && len(parts[1]) > 0 {
			noise = parts[1][0]
		}
		if noise&1 != 0 {
			source = "// retained trivia\r\n" + strings.ReplaceAll(source, ";", ";\r\n")
		}
		if noise&2 != 0 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"main.vibe\"]}"})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var got []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			prefix := d.Source()
			if prefix == "" {
				prefix = "TS"
			}
			got = append(got, fmt.Sprintf("%s%04d", prefix, d.Code()))
		}
		slices.Sort(got)
		if !slices.Equal(got, tc.Codes) {
			Gap(t, "FuzzRejectedConstructorFieldHeaders", "header:"+tc.Key, "chapter 5: %s; want %v, got %v\n%s", rejectedConstructorHeaderQuote, tc.Codes, got, source)
		}
	})
}

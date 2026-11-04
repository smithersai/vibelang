package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const shapeQualifierNativeQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."

func shapeQualifierQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), shapeQualifierNativeQuote) {
		t.Fatalf("chapter 007 no longer says %q", shapeQualifierNativeQuote)
	}
	if !strings.Contains(SpecText("005-services.md"), serviceShapeRenameQuote) {
		t.Fatal("chapter 005 service Shape counterpart changed")
	}
}
func TestServiceShapeQualifierFallbackQuoted(t *testing.T) { shapeQualifierQuoted(t) }

func FuzzServiceShapeQualifierFallback(f *testing.F) {
	startShortBudget(f)
	shapeQualifierQuoted(f)
	var cases []struct {
		Key, Source string
		Errors      []string
		Files       map[string]string
	}
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/shape-qualifier-fallback.json"))
	if err != nil {
		f.Fatal(err)
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, c := range cases {
		f.Add([]byte(c.Key + "\x00\x00"))
		f.Add([]byte(c.Key + "\x00\x01"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		index := slices.IndexFunc(cases, func(c struct {
			Key, Source string
			Errors      []string
			Files       map[string]string
		}) bool {
			return c.Key == parts[0]
		})
		if index < 0 {
			index = len(data) % len(cases)
		}
		c := cases[index]
		source := c.Source
		if len(parts) == 2 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "// preserve qualifier trivia\n" + strings.ReplaceAll(strings.ReplaceAll(source, "Missing", "AbsentCafé"), "\"", "'")
		}
		files := map[string]string{"main.vibe": source, "package.json": servicesPackage}
		for name, text := range c.Files {
			files[name] = text
		}
		r, err := w.Compile(t.Context(), Project{Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":[]},"files":["main.vibe"]}`, Files: files})
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
			got = append(got, fmt.Sprintf("%s%d", prefix, d.Code()))
		}
		slices.Sort(got)
		if !slices.Equal(got, c.Errors) {
			Gap(t, "FuzzServiceShapeQualifierFallback", c.Key, "%s; want %v, got %v", shapeQualifierNativeQuote, c.Errors, got)
			return
		}
		ExpectPending(t, "FuzzServiceShapeQualifierFallback", c.Key)
		ExpectPending(t, "FuzzServiceShapeQualifierFallback", specCorpusKey(t))
	})
}

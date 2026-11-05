package grammaradmission

import (
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

// A lowering extracted from a receiver's file still gives the source form its
// meaning. Neither a file move nor a standalone entry point can erase its
// specification obligation.
func TestHooksIncludeExtractedLowering(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"vibelang/lower.go":                   "type lowering struct{}; func (*lowering) visit() {}; func localHelper() {}",
		"vibelang/error_constructor_lower.go": "func errorConstructor() {}; func constructorHelper() {}",
		"vibelang/error_payload.go":           "func lowerFields() {}; func ordinaryHelper() {}",
		"vibelang/ordinary.go":                "func helper() {}",
		"vibelang/ignored_lower_test.go":      "func lowerTestFixture() {}",
		"parser/vibelang_sample.go":           "func syntaxHelper() {}",
		"parser/parser.go":                    "func parseVibeLangSample() {}; func parseNative() {}",
	}
	for file, body := range files {
		writeCensusFile(t, root, file, body)
	}
	hooks, err := Hooks(root)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for hook := range hooks {
		got = append(got, hook)
	}
	slices.Sort(got)
	want := []string{
		"parser/parser.go:parseVibeLangSample",
		"parser/vibelang_sample.go:syntaxHelper",
		"vibelang/error_constructor_lower.go:constructorHelper",
		"vibelang/error_constructor_lower.go:errorConstructor",
		"vibelang/error_payload.go:lowerFields",
		"vibelang/lower.go:localHelper",
		"vibelang/lower.go:lowering.visit",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("a moved lowering must retain its census entry:\ngot  %q\nwant %q", got, want)
	}
}

// Move and rename a standalone lowering independently, then require its row.
// Removing the row must fail even when the old receiver file remains.
func FuzzExtractedLoweringCensus(f *testing.F) {
	f.Add([]byte("constructor"), false)
	f.Add([]byte("fields"), true)
	f.Fuzz(func(t *testing.T, data []byte, byFile bool) {
		if len(data) == 0 || len(data) > 32 {
			t.Skip("bounded file and symbol names")
		}
		name := "helper"
		for _, b := range data {
			name += string(rune('a' + b%26))
		}
		file, symbol := "vibelang/"+name+".go", "lower"+name
		if byFile {
			file, symbol = "vibelang/"+name+"_lower.go", name
		}
		root := t.TempDir()
		writeCensusFile(t, root, "vibelang/lower.go", "type lowering struct{}; func (*lowering) visit() {}")
		writeCensusFile(t, root, file, "func "+symbol+"() {}")
		hooks, err := Hooks(root)
		if err != nil {
			t.Fatal(err)
		}
		hook := file + ":" + symbol
		if !hooks[hook] {
			t.Fatalf("extracted lowering %s escaped the census", hook)
		}
		row := "vibelang/lower.go:lowering.visit\tadmission:fixture\t-\tpending\tfixture\n"
		specPath := func(chapter string) string { return filepath.Join(root, chapter) }
		errs, _ := Check(hooks, row, specPath)
		if len(errs) != 1 || !strings.Contains(errs[0], "unaccounted syntax/lowering hook "+hook+";") {
			t.Fatalf("a missing extracted lowering row must fail alone: %q", errs)
		}
		row += hook + "\tadmission:fixture\t-\tpending\tfixture\n"
		errs, stale := Check(hooks, row, specPath)
		if len(errs) != 0 || len(stale) != 0 {
			t.Fatalf("adding the exact extracted lowering row must pass: errors=%q stale=%q", errs, stale)
		}
	})
}

func writeCensusFile(t *testing.T, root, file, body string) {
	t.Helper()
	path := filepath.Join(root, "typescript/tsc/internal", file)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("package fixture\n"+body+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

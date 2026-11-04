package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const staticErrorConstructorQuote = "Otherwise a member gets one diagnostic: the first row that names it."
const staticErrorConstructorRow = "| a constructor in an \x60error\x60 or \x60schema error\x60 body | \x60EK1301\x60 |"

var staticErrorConstructorForms = []string{"error", "schema error"}
var staticErrorConstructorModifiers = []string{"static", "public static", "private static", "protected static"}
var staticErrorConstructorNames = []string{"constructor", "\"constructor\"", "[\"constructor\"]"}

type staticErrorConstructorVariant struct{ form, modifier, name, parameters int }

func (v staticErrorConstructorVariant) key() string {
	names := []string{"keyword", "quoted", "computed"}
	forms := []string{"plain", "schema"}
	parameters := []string{"empty", "parameter"}
	return fmt.Sprintf("%s/%s/%s/%s", forms[v.form], strings.ReplaceAll(staticErrorConstructorModifiers[v.modifier], " ", "-"), names[v.name], parameters[v.parameters])
}
func staticErrorConstructorVariants() ([]staticErrorConstructorVariant, []string) {
	var variants []staticErrorConstructorVariant
	var names []string
	for form := range staticErrorConstructorForms {
		for modifier := range staticErrorConstructorModifiers {
			for name := range staticErrorConstructorNames {
				for parameters := 0; parameters < 2; parameters++ {
					v := staticErrorConstructorVariant{form, modifier, name, parameters}
					variants = append(variants, v)
					names = append(names, v.key())
				}
			}
		}
	}
	return variants, names
}
func TestStaticErrorConstructorQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", staticErrorConstructorQuote, staticErrorConstructorRow)
}
func TestStaticErrorConstructorKeys(t *testing.T) {
	_, names := staticErrorConstructorVariants()
	if len(names) != 48 {
		t.Fatalf("got%dkeys", len(names))
	}
	for _, name := range names {
		p := filepath.Join("testdata/fuzz/FuzzStaticErrorConstructor", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatal(p)
		}
	}
}
func FuzzStaticErrorConstructor(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", staticErrorConstructorQuote, staticErrorConstructorRow)
	variants, names := staticErrorConstructorVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		parameters := ""
		if v.parameters == 1 {
			parameters = "value:number"
		}
		main := fmt.Sprintf("export %s E {%s %s(%s){}}\n", staticErrorConstructorForms[v.form], staticErrorConstructorModifiers[v.modifier], staticErrorConstructorNames[v.name], parameters)
		files := map[string]string{"main.vibe": main}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r4Errors(r.Diagnostics)
		want := "EK1301"
		if v.name == 2 {
			want = "EK1302"
		}
		if len(errors) != 1 || errors[0] != want {
			Gap(t, "FuzzStaticErrorConstructor", "member:"+v.key(), "003-failures: %s; %s; key%s got%v want one%s\n%s", staticErrorConstructorQuote, staticErrorConstructorRow, v.key(), errors, want, Archive(files))
		}
	})
}

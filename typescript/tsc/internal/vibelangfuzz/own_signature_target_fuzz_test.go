package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const ownSignatureQuote = "A destination typed by the source's own signature carries the source's thrown type, so it admits it"
const ownSignatureOtherQuote = "A different callable's type query, `const p: typeof parse = other`, is a type without `@throws` and admits only `never`."

// Sources: an untagged foreign declaration, a foreign interface method, an
// untagged alias of one, a tagged declaration, and another declaration
// against the first one's type query. Sites: the destination is the value's own
// type (typeof, an inferred type parameter, Object.assign, an inferred member),
// or a written function type, the control: it admits only never, so even the
// tagged Error source reports there.
var ownSignatureSources = []string{"foreign", "method", "alias", "tagged", "other"}
var ownSignatureSites = []string{"typeof", "identity", "assign", "identity-member", "written"}

func ownSignatureNames() []string {
	var names []string
	for _, source := range ownSignatureSources {
		for _, site := range ownSignatureSites {
			names = append(names, source+"/"+site)
		}
	}
	return names
}

func TestOwnSignatureTargetQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", ownSignatureQuote, ownSignatureOtherQuote)
}

func TestOwnSignatureTargetKeys(t *testing.T) {
	for _, name := range ownSignatureNames() {
		p := filepath.Join("testdata/fuzz/FuzzOwnSignatureTarget", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatal(p)
		}
	}
}

func FuzzOwnSignatureTarget(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", ownSignatureQuote, ownSignatureOtherQuote)
	names := ownSignatureNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		source, site := ownSignatureSources[i/len(ownSignatureSites)], ownSignatureSites[i%len(ownSignatureSites)]
		helpers := "export declare function source(path: string): string\nexport declare function other(path: string): string\n/** @throws {Error} */\nexport declare function tagged(path: string): string\nexport interface Owner { method(path: string): string }\nexport declare const owner: Owner\n"
		prefix := "import { source, other, tagged, owner } from \"./helpers.js\"\nconst identity = <T>(x: T): T => x\n"
		value, self := "source", "source"
		switch source {
		case "method":
			value, self = "owner.method", "owner.method"
		case "alias":
			prefix += "const value = source\n"
			value, self = "value", "value"
		case "tagged":
			value, self = "tagged", "tagged"
		case "other":
			value = "other"
		}
		body := ""
		switch site {
		case "typeof":
			body = "export const bound: typeof " + self + " = " + value + "\n"
		case "identity":
			body = "export const bound = identity(" + value + ")\n"
		case "assign":
			body = "export const bound = Object.assign({}, { run: " + value + " })\n"
		case "identity-member":
			body = "export const bound = identity({ run: " + value + " })\n"
		case "written":
			body = "export const bound: (path: string) => string = " + value + "\n"
		}
		files := map[string]string{"main.vibe": prefix + body, "helpers.d.ts": helpers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\",\"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r4Errors(r.Diagnostics)
		want := site == "written" || site == "typeof" && source == "other"
		quote := ownSignatureQuote
		if want {
			quote = ownSignatureOtherQuote
		}
		if len(errors) > 1 || len(errors) == 1 && errors[0] != "EK0402" || (len(errors) == 1) != want {
			Gap(t, "FuzzOwnSignatureTarget", "own-signature:"+source+"/"+site, "003-failures: %s; got %v want EK0402=%t\n%s", quote, errors, want, Archive(files))
		}
	})
}

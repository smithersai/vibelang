package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceKeyContextTarget = "FuzzServiceDerivedKeyContext"
const serviceKeyDerivationQuote = "It is derived from the package, the file and the name:"
const serviceKeyContextQuote = "A service in a file outside any package (or in one whose `package.json` has no string `name`), or declared inside a function or block, has no derived key: omitting `static readonly key` there is a compile error (`EK0903`) with a quick fix that inserts one."

var serviceKeyContexts = []struct {
	key, context, pkg string
	derived           bool
}{
	{"module", "SERVICE", servicesPackage, true},
	{"namespace", "namespace Keys { export SERVICE }", servicesPackage, true},
	{"nested-namespace", "namespace Keys { export namespace Inner { export SERVICE } }", servicesPackage, true},
	{"empty-package-name", "SERVICE", `{"name":"","type":"module"}`, true},
	{"block", "{ SERVICE }", servicesPackage, false},
	{"if-block", "if (true) { SERVICE }", servicesPackage, false},
	{"function", "function local() { SERVICE }", servicesPackage, false},
	{"function-expression", "const local = function () { SERVICE }", servicesPackage, false},
	{"arrow", "const local = () => { SERVICE }", servicesPackage, false},
	{"async-function", "async function local() { SERVICE }", servicesPackage, false},
	{"method", "class Host { local() { SERVICE } }", servicesPackage, false},
	{"unnamed-package", "SERVICE", `{"type":"module"}`, false},
	{"numeric-package", "SERVICE", `{"name":12,"type":"module"}`, false},
	{"boolean-package", "SERVICE", `{"name":true,"type":"module"}`, false},
	{"null-package", "SERVICE", `{"name":null,"type":"module"}`, false},
	{"outside-package", "SERVICE", "", false},
}

func serviceKeyContextChapter(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), serviceKeyDerivationQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceKeyDerivationQuote)
	}
	if !strings.Contains(string(chapter), serviceKeyContextQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceKeyContextQuote)
	}
}

func TestServiceDerivedKeyContextQuoted(t *testing.T) { serviceKeyContextChapter(t) }

func FuzzServiceDerivedKeyContext(f *testing.F) {
	startShortBudget(f)
	serviceKeyContextChapter(f)
	for _, rule := range serviceKeyContexts {
		f.Add(rule.key, uint8(0))
		f.Add(rule.key, uint8(7))
	}
	w := NewWorkspace(f)
	// NewWorkspace installs an unnamed package for module execution. This
	// static target also checks the absence of every ancestor package.
	if err := os.Remove(filepath.Join(w.Dir, "package.json")); err != nil {
		f.Fatal(err)
	}
	for dir := filepath.Dir(w.Dir); ; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "package.json")); !os.IsNotExist(err) {
			f.Fatalf("outside-package oracle requires no ancestor package at %s: %v", dir, err)
		}
		if filepath.Dir(dir) == dir {
			break
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		choice := 0
		if len(key) > 0 {
			choice = int(key[0]) % len(serviceKeyContexts)
		}
		for i, rule := range serviceKeyContexts {
			if key == rule.key {
				choice = i
				break
			}
		}
		rule := serviceKeyContexts[choice]
		name, shape, literal := "S", "value: number", strconv.Quote("coverage/S")
		if variant&1 != 0 {
			name, shape = "Café", "readonly value: number"
		}
		if variant&2 != 0 {
			literal = `""`
		}
		declaration := func(explicit bool) string {
			body := shape
			if explicit {
				body = "static readonly key = " + literal + "; " + body
			}
			source := strings.ReplaceAll(rule.context, "SERVICE", "service "+name+" { "+body+" }") + "\nexport {}\n"
			if variant&4 != 0 {
				source = "// retained trivia\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
			}
			return source
		}
		compile := func(explicit bool) []string {
			files := map[string]string{"main.vibe": declaration(explicit)}
			if rule.pkg != "" {
				files["package.json"] = rule.pkg
			}
			result, err := w.Compile(t.Context(), Project{Files: files})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			var errors []string
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprintf("%s%04d", d.Source(), d.Code()))
				}
			}
			return errors
		}
		if errors := compile(true); len(errors) != 0 {
			Gap(t, serviceKeyContextTarget, "explicit:"+rule.key, "%s; explicit-key control rejected with %v:\n%s", serviceKeyContextQuote, errors, declaration(true))
			return
		}
		errors := compile(false)
		if rule.derived {
			if len(errors) != 0 {
				Gap(t, serviceKeyContextTarget, "derived:"+rule.key, "chapter 5 permits a named module/namespace key; got %v:\n%s", errors, declaration(false))
				return
			}
		} else if len(errors) != 1 || errors[0] != "EK0903" {
			Gap(t, serviceKeyContextTarget, "missing:"+rule.key, "%s; want only EK0903, got %v:\n%s", serviceKeyContextQuote, errors, declaration(false))
			return
		}
		ExpectPending(t, serviceKeyContextTarget, specCorpusKey(t))
	})
}

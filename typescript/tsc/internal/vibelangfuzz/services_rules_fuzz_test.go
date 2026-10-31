package vibelangfuzz

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Each quote is read from chapter 5 (Services, "Static rules") at test time. A
// valid control must compile before a forbidden form can prove that the
// compiler rejects it with the code its table row assigns. The neighbourhood
// of the service-member reports: a service is a key whose members are
// signatures, as in an interface.
var servicesRules = []struct{ key, quote, good, bad string }{
	{"new-service", "`new Users()`", "export service Users { n: number }\nexport function f(): number { return 1 }", "export service Users { n: number }\nexport const u = new Users()"},
	{"extends-service", "`class X extends Users {}`", "export service Users { n: number }\nexport class X {}", "export service Users { n: number }\nexport class X extends Users {}"},
	{"instanceof-service", "`impl instanceof Users`", "export service Users { n: number }\nexport function f(impl: unknown): boolean { return typeof impl === \"object\" }", "export service Users { n: number }\nexport function f(impl: unknown): boolean { return impl instanceof Users }"},
	{"generic-service", "`service Repo<T> { … }`", "export service Repo { n: number }", "export service Repo<T> { n: T }"},
	{"key-without-readonly", "`static key = \"a\"` without `readonly`", "export service Users {\n  static readonly key = \"a\"\n  n: number\n}", "export service Users {\n  static key = \"a\"\n  n: number\n}"},
	{"key-not-literal", "a `key` whose initializer is not a string literal", "export service Users {\n  static readonly key: string = \"S\"\n  n: number\n}", "const prefix = \"x\"\nexport service Users {\n  static readonly key = prefix + \"S\"\n  n: number\n}"},
	{"duplicate-key", "two services with the same key anywhere in the program", "export service A {\n  static readonly key = \"k1\"\n  n: number\n}\nexport service B {\n  static readonly key = \"k2\"\n  n: number\n}", "export service A {\n  static readonly key = \"k\"\n  n: number\n}\nexport service B {\n  static readonly key = \"k\"\n  n: number\n}"},
	{"member-body", "any member that is not a `PropertySignature`, a `MethodSignature`", "export service Users { find(id: string): string!! }", "export service Users { find(id: string): string!! { return id } }"},
	{"member-initializer", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { region: string }", "export service Users { region = \"eu\" }"},
	{"member-private", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { private n: number }"},
	{"member-protected", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { protected n: number }"},
	{"member-declare", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { declare n: number }"},
	{"member-accessor", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { accessor n: number }"},
	{"member-override", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { override n: number }"},
	{"member-private-name", "a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`)", "export service Users { n: number }", "export service Users { #n: number }"},
	{"member-getter", "a `get` or `set` accessor", "export service Users { n: number }", "export service Users { get n(): number { return 1 } }"},
	{"member-constructor", "a `constructor`", "export service Users { n: number }", "export service Users {\n  constructor() {}\n  n: number\n}"},
	{"member-index-signature", "an index signature", "export service Users { n: number }", "export service Users { [k: string]: number }"},
	{"member-static-other", "or another `static`", "export service Users { n: number }", "export service Users {\n  static readonly label = \"users\"\n  n: number\n}"},
	{"member-effect-modifier", "A bodyless `effect find(id: string): User!NotFound`", "export service Users { find(id: string): string!! }", "export service Users { effect find(id: string): string!! }"},
	{"extends-clause", "`service S extends Base { }`", "export service Base { n: number }\nexport service S { m: number }", "export service Base { n: number }\nexport service S extends Base { }"},
	{"implements-clause", "`service S implements I { }`", "interface I { n: number }\nexport service S { n: number }", "interface I { n: number }\nexport service S implements I { }"},
	{"export-default", "`export default service S { }`", "service S { n: number }\nexport { S as default }", "export default service S { n: number }"},
}

func servicesRulesChapter(f testing.TB) string {
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(chapter), "A member gets one diagnostic: the first row below that names it.") {
		f.Fatal("chapter 5 no longer states the one-diagnostic-per-member rule")
	}
	for _, rule := range servicesRules {
		if !strings.Contains(string(chapter), rule.quote) {
			f.Fatalf("%s: chapter 5 no longer says %q", rule.key, rule.quote)
		}
		if servicesRuleDiagnostic(string(chapter), rule.quote) == 0 {
			f.Fatalf("%s: no static-rules row of chapter 5 assigns a code to %q", rule.key, rule.quote)
		}
	}
	return string(chapter)
}

func TestServicesRulesQuoted(t *testing.T) { servicesRulesChapter(t) }

// A named package.json gives each service a derived key (chapter 5), so a
// control needs no written key.
const servicesPackage = "{\"type\":\"module\",\"name\":\"@fuzz/services\"}"

func FuzzServicesRules(f *testing.F) {
	startShortBudget(f)
	chapter := servicesRulesChapter(f)
	for _, rule := range servicesRules {
		f.Add([]byte(rule.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice := 0
		if len(data) != 0 {
			choice = int(data[0]) % len(servicesRules)
		}
		for i, rule := range servicesRules {
			if string(data) == rule.key {
				choice = i
				break
			}
		}
		rule := servicesRules[choice]
		var compileErrors []string
		var errorCodes map[int32]bool
		compile := func(source string) bool {
			compileErrors = nil
			errorCodes = map[int32]bool{}
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source + "\n", "package.json": servicesPackage}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					compileErrors = append(compileErrors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
					if IsEK(d) {
						errorCodes[d.Code()] = true
					}
				}
			}
			return len(compileErrors) == 0
		}
		if !compile(rule.good) {
			Gap(t, "FuzzServicesRules", "control:"+rule.key, "chapter 5: %s; valid control does not compile:\n%s\n%s", rule.quote, rule.good, strings.Join(compileErrors, "\n"))
			return
		}
		if compile(rule.bad) {
			Gap(t, "FuzzServicesRules", "reject:"+rule.key, "chapter 5: %s; forbidden form compiled:\n%s", rule.quote, rule.bad)
			return
		}
		if expected := servicesRuleDiagnostic(chapter, rule.quote); !errorCodes[expected] {
			Gap(t, "FuzzServicesRules", "diagnostic:"+rule.key, "chapter 5 requires EK%04d for %s; got:\n%s", expected, rule.key, strings.Join(compileErrors, "\n"))
			return
		}
		ExpectPending(t, "FuzzServicesRules", "control:"+rule.key)
		ExpectPending(t, "FuzzServicesRules", "reject:"+rule.key)
		ExpectPending(t, "FuzzServicesRules", "diagnostic:"+rule.key)
		ExpectPending(t, "FuzzServicesRules", specCorpusKey(t))
	})
}

// servicesRuleDiagnostic reads the assigned code from the static-rules table
// row of chapter 5 that contains quote: the first EK code on that row is the
// Code column (a Why column may cite another code after it).
func servicesRuleDiagnostic(chapter, quote string) int32 {
	pattern := regexp.MustCompile("EK([0-9]{4})")
	for _, line := range strings.Split(chapter, "\n") {
		if !strings.HasPrefix(line, "|") || !strings.Contains(line, quote) {
			continue
		}
		if match := pattern.FindStringSubmatch(line); match != nil {
			code, _ := strconv.Atoi(match[1])
			return int32(code)
		}
	}
	return 0
}

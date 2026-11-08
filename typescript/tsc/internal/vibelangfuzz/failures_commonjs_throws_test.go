package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const commonJSThrowsTarget = "FuzzCommonJSThrows"

var commonJSThrowsQuotes = []string{
	"Tags attach to call signatures:",
	"| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |",
	"| no tag | `unknown` |",
	"A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function.",
	"| In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |",
}

func assertCommonJSThrowsRules(t testing.TB) {
	for _, q := range commonJSThrowsQuotes {
		if !strings.Contains(SpecText(failuresChapter), q) {
			t.Fatalf("CommonJS throws rule changed: %s", q)
		}
	}
}

func TestCommonJSThrowsQuoted(t *testing.T) { assertCommonJSThrowsRules(t) }

var commonJSThrowsShapes = []struct{ name, assignment, importClause string }{
	{"exports", "exports.parse = function(value) { return value.length }", "{ parse }"},
	{"module-property", "module.exports.parse = function(value) { return value.length }", "{ parse }"},
	{"computed-property", "exports[\"parse\"] = function(value) { return value.length }", "{ parse }"},
	{"default-export", "module.exports = function(value) { return value.length }", "parse"},
	{"arrow", "exports.parse = (value) => value.length", "{ parse }"},
	{"parenthesized", "exports.parse = (function(value) { return value.length })", "{ parse }"},
	{"declaration", "function parse(value) { return value.length }; exports.parse = parse", "{ parse }"},
}

func commonJSThrowsKeys() []string {
	var keys []string
	for _, shape := range commonJSThrowsShapes {
		for _, contract := range []string{"RangeError", "never", "unknown", "untagged"} {
			for _, home := range []string{"effect", "plain", "caught", "wrapped"} {
				keys = append(keys, shape.name+":"+contract+":"+home)
			}
		}
	}
	return keys
}

func checkCommonJSThrows(t *testing.T, w *Workspace, key string, choice uint8) {
	t.Helper()
	parts := strings.Split(key, ":")
	shape := commonJSThrowsShapes[slices.IndexFunc(commonJSThrowsShapes, func(s struct{ name, assignment, importClause string }) bool { return s.name == parts[0] })]
	contract, home := parts[1], parts[2]
	annotation := "/**\n * @param {string} value\n * @returns {number}\n"
	if contract != "untagged" {
		annotation += " * @throws {" + contract + "}\n"
	}
	lib := annotation + " */\n" + shape.assignment + "\n"
	head, body := "", "return parse(\"ok\")"
	if home == "effect" || home == "wrapped" {
		head = "effect "
	}
	if home == "caught" {
		body = "try { return parse(\"ok\") } catch { return -1 }"
	}
	if home == "wrapped" {
		body = "return try Effect.try(() => parse(\"ok\"))"
	}
	if choice&1 != 0 {
		body = "{\n" + body + "\n}"
	}
	source := "import " + shape.importClause + " from \"./foreign.cjs\"\nexport " + head + "function probe() {" + body + "}\n"
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true,"allowJs":true,"checkJs":false},"files":["main.vibe","foreign.cjs"]}`
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.cjs": lib, "package.json": `{"type":"module"}`}, Config: config})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	want := 0
	if home == "effect" && contract != "never" {
		want = 403
	}
	if home == "plain" && contract != "never" && contract != "untagged" {
		want = 401
	}
	var errors []string
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, describe(d))
			if !IsEK(d) || int(d.Code()) != want {
				Gap(t, commonJSThrowsTarget, key, "VIP-4 throws contract %q: unexpected %s", commonJSThrowsQuotes[1], describe(d))
			}
		}
	}
	count := 0
	if want != 0 {
		count = 1
	}
	if len(errors) != count {
		Gap(t, commonJSThrowsTarget, key, "VIP-4 %q: errors=%v, want %d EK%04d", commonJSThrowsQuotes[0], errors, count, want)
	}
}

func TestCommonJSThrows(t *testing.T) {
	assertCommonJSThrowsRules(t)
	w := NewWorkspace(t)
	for _, key := range commonJSThrowsKeys() {
		t.Run(key, func(t *testing.T) { checkCommonJSThrows(t, w, key, 0) })
	}
}

func FuzzCommonJSThrows(f *testing.F) {
	startShortBudget(f)
	assertCommonJSThrowsRules(f)
	keys := commonJSThrowsKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(choice)%len(keys)]
		}
		checkCommonJSThrows(t, w, key, choice)
	})
}

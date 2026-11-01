package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

// Functions, "Legacy JavaScript" (VIP-1 and VIP-4, amended 2026-10-29).
var legacyJavaScriptQuotes = []string{
	"every `IdentifierReference` named `eval`",
	"every `IdentifierReference` resolving to the global `Function` constructor, except the right operand of `instanceof`",
	"every `IdentifierReference` named `arguments`",
	"every `with` statement",
	"Property names on ordinary objects, such as `o.arguments`, `o.eval` and `{ var: 1 }`, are names, not references, and are unaffected",
	"Reading a property named `constructor` from a value whose static type is a function type or `Function` is `EK0107`",
	"A string-literal `data:` or `blob:` specifier, in `import(…)` or an `import` declaration, is `EK0107`",
}

func requireLegacyJavaScriptQuotes(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range legacyJavaScriptQuotes {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("missing legacy JavaScript rule: %q", quote)
		}
	}
}

func TestLegacyJavaScriptQuoted(t *testing.T) { requireLegacyJavaScriptQuotes(t) }

// legacyJavaScriptContexts wraps one statement in each kind of function the
// rule names ("anywhere in a `.vibe` file, plain functions included").
var legacyJavaScriptContexts = map[string]func(statement string) string{
	"plain":  func(s string) string { return "export function load(): unknown { " + s + " }" },
	"effect": func(s string) string { return "export effect function load() { " + s + " }" },
	"async":  func(s string) string { return "export async function load() { " + s + " }" },
	"arrow":  func(s string) string { return "export const load = () => { " + s + " }" },
	"method": func(s string) string { return "export class Loader { load(): unknown { " + s + " } }" },
}

// legacyJavaScriptForms maps a key to the statement it tests and the number
// of EK0107 diagnostics the rule gives it.
var legacyJavaScriptForms = map[string]struct {
	statement string
	want      int
}{
	"eval-direct":                           {`return eval("1")`, 1},
	"eval-indirect":                         {`return (0, eval)("1")`, 1},
	"eval-optional":                         {`return eval?.("1")`, 1},
	"eval-alias":                            {`const e = eval; return e`, 1},
	"eval-property-control":                 {`const o = { eval: 1 }; return o.eval`, 0},
	"eval-text-control":                     {`return "eval(1)"`, 0},
	"arguments":                             {`return arguments.length`, 1},
	"arguments-shorthand":                   {`return { arguments }`, 1},
	"arguments-property-control":            {`const o = { arguments: 1 }; return o.arguments`, 0},
	"function-new":                          {`return new Function("return 1")`, 1},
	"function-call":                         {`return Function("return 1")`, 1},
	"function-optional-call":                {`return Function?.("return 1")`, 1},
	"function-alias":                        {`const F = Function; return F`, 1},
	"function-member":                       {`return Function.call(null, "return 7")`, 1},
	"function-instanceof-control":           {`const x: unknown = 1; return x instanceof Function`, 0},
	"function-prototype-control":            {`return Function.prototype.toString.call(() => 1)`, 0},
	"function-prototype-element-control":    {`return Function["prototype"]`, 0},
	"function-type-control":                 {`const f: Function = () => 1; return f`, 0},
	"with":                                  {`const o = { x: 1 }; with (o) { return 1 }`, 1},
	"constructor-arrow":                     {`return (async () => {}).constructor`, 1},
	"constructor-function":                  {`const f = () => 1; return f.constructor`, 1},
	"constructor-element":                   {`const f = () => 1; return f["constructor"]`, 1},
	"constructor-write-control":             {"function f(): number { return 1 }; function g(): number { return 2 }; f.constructor = g; return f", 0},
	"constructor-element-write-control":     {"function f(): number { return 1 }; function g(): number { return 2 }; f[\"constructor\"] = g; return f", 0},
	"constructor-destructure-write-control": {"function f(): number { return 1 }; function g(): number { return 2 }; ({ value: f.constructor } = { value: g }); return f", 0},
	"constructor-for-of-write-control":      {"function f(): number { return 1 }; function g(): number { return 2 }; for (f.constructor of [g]) {} return f", 0},
	"constructor-read-write":                {"function f(): number { return 1 }; function g(): number { return 2 }; f.constructor ||= g; return f", 1},
	"constructor-write-rhs-control":         {"function f(): number { return 1 }; function g(): number { return 2 }; f.constructor = eval(\"1\"); return f", 1},
	"constructor-global-write":              {"function f(): number { return 1 }; function g(): number { return 2 }; Function.constructor = g; return f", 1},
	"constructor-object-control":            {`return ({}).constructor`, 0},
	"constructor-any-control":               {`const v: any = 1; return v.constructor`, 0},
	"specifier-data":                        {`return import("data:text/javascript,export default 1")`, 1},
	"specifier-blob":                        {`return import("blob:https://example.test/1")`, 1},
	"specifier-computed-control":            {`const spec = "./other.js"; return import(spec)`, 0},
	"constructor-delete-control":            {"function f(): number { return 1 }; function g(): number { return 2 }; delete f.constructor; return f", 0},
	"constructor-delete-parens-control":     {"function f(): number { return 1 }; function g(): number { return 2 }; delete ((f[\"constructor\"])); return f", 0},
	"constructor-assert-write-control":      {"function f(): number { return 1 }; function g(): number { return 2 }; (f.constructor as Function) = g; return f", 0},
	"constructor-nonnull-write-control":     {"function f(): number { return 1 }; function g(): number { return 2 }; (f.constructor!) = g; return f", 0},
	"constructor-satisfies-write-control":   {"function f(): number { return 1 }; function g(): number { return 2 }; (f.constructor satisfies Function) = g; return f", 0},
	"constructor-assert-read":               {"function f(): number { return 1 }; function g(): number { return 2 }; return (f.constructor as Function)", 1},
	"constructor-delete-base-read":          {"function f(): number { return 1 }; function g(): number { return 2 }; delete (f.constructor as any).property; return f", 1},
	"constructor-delete-global":             {"function f(): number { return 1 }; function g(): number { return 2 }; delete Function.constructor; return f", 1},
}

func FuzzLegacyJavaScript(f *testing.F) {
	startShortBudget(f)
	requireLegacyJavaScriptQuotes(f)
	for key := range legacyJavaScriptForms {
		for where := range legacyJavaScriptContexts {
			f.Add(key, where, uint8(0))
		}
		f.Add(key, "plain", uint8(1))
		f.Add(key, "effect", uint8(2))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, where string, mode uint8) {
		form, ok := legacyJavaScriptForms[key]
		if !ok {
			key, form = "eval-direct", legacyJavaScriptForms["eval-direct"]
		}
		wrap, ok := legacyJavaScriptContexts[where]
		if !ok {
			where, wrap = "plain", legacyJavaScriptContexts["plain"]
		}
		statement := form.statement
		switch mode % 3 {
		case 1:
			statement = "/* legacy */ " + statement + " /* eval Function arguments with */"
		case 2:
			statement = strings.ReplaceAll(statement, "return ", "return\t")
		}
		source := wrap(statement)
		if mode%3 == 2 {
			source = "// café 😀 arguments eval\n" + source
		}
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 107 {
				count++
			}
		}
		if count != form.want {
			Gap(t, "FuzzLegacyJavaScript", "legacy:"+key+":"+where, "%s; got %d EK0107, want %d\n%s\n%v", legacyJavaScriptQuotes[0], count, form.want, source, result.Diagnostics)
		}
	})
}

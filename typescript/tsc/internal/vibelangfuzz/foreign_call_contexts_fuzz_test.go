package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

// Chapter 1, Static rules, and chapter 3, Plain code never throws and Code
// outside the generator: where a call whose throwing is unknown is EK0403,
// EK0401 or an ordinary call.
var foreignCallContextQuotes = []struct{ chapter, quote string }{
	{"001-functions.md", "`try` works like `await`, so an `effect` function's parameter list, a class field initializer and a `static` block are not effect code"},
	{"003-failures.md", "class field initializers, `static` blocks, every parameter list except an ordinary `async` function's"},
	{"003-failures.md", "A call whose throwing is unknown, such as an unannotated `.ts` function, stays an ordinary call"},
	{"003-failures.md", "In an effectful function's parameter list a default whose thrown type is not `never` is `EK0401`"},
	{"003-failures.md", "A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function."},
	{"003-failures.md", "In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`."},
	{"003-failures.md", "Effect code calls a function whose thrown type is `never` directly."},
}

func requireForeignCallContextQuotes(t testing.TB) {
	t.Helper()
	for _, q := range foreignCallContextQuotes {
		chapter, err := os.ReadFile(SpecPath(q.chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(chapter), q.quote) {
			t.Fatalf("missing %s rule: %q", q.chapter, q.quote)
		}
	}
}

func TestForeignCallContextsQuoted(t *testing.T) { requireForeignCallContextQuotes(t) }

// foreignCallContextLibrary is an unannotated TypeScript function: its
// throwing is unknown.
const foreignCallContextLibrary = "export function plain(x: number): number { return x }\n" +
	"/** @throws {Error} */ export function tagged(x: number): number { return x }\n" +
	"/** @throws {never} */ export function safe(x: number): number { return x }\n"

// foreignCallContextForms maps a key to a declaration that calls one foreign function
// and the EK0401 and EK0403 counts the rules give it.
var foreignCallContextForms = map[string]struct {
	source string
	ek0401 int
	ek0403 int
}{
	"written-contract-body-control":  {`export effect function f() { return tagged(1) }`, 0, 1},
	"written-contract-field-control": {`export effect function f() { class C { x = tagged(1) } return new C().x }`, 1, 0},
	"written-contract-param-control": {`export effect function f(x = tagged(1)) { return x }`, 1, 0},
	"never-contract-body-control":    {`export effect function f() { return safe(1) }`, 0, 0},
	"never-contract-field-control":   {`export effect function f() { class C { x = safe(1) } return new C().x }`, 0, 0},
	"never-contract-param-control":   {`export effect function f(x = safe(1)) { return x }`, 0, 0},

	"effect-body-control":         {`export effect function f() { return plain(1) }`, 0, 1},
	"effect-arrow-body-control":   {`export const f = effect () => plain(1)`, 0, 1},
	"heritage-control":            {`export effect function f() { const B = class {}; class C extends (plain(1) > 0 ? B : B) {} return C }`, 0, 1},
	"field":                       {`export effect function f() { class C { x = plain(1) } return new C().x }`, 0, 0},
	"field-static":                {`export effect function f() { class C { static y = plain(1) } return C.y }`, 0, 0},
	"field-accessor":              {`export effect function f() { class C { accessor a = plain(1) } return new C().a }`, 0, 0},
	"field-nested-value":          {`export effect function f() { class C { x = { v: [plain(1)] } } return new C().x.v }`, 0, 0},
	"field-class-expression":      {`export effect function f() { const C = class { x = plain(1) }; return new C().x }`, 0, 0},
	"field-in-effect-method":      {`export class K { effect m() { class C { x = plain(1) } return new C().x } }`, 0, 0},
	"field-in-effect-arrow":       {`export const f = effect () => { class C { x = plain(1) } return new C().x }`, 0, 0},
	"field-in-producer":           {`export effect function* f() { class C { x = plain(1) } yield new C().x }`, 0, 0},
	"static-block":                {`export effect function f() { class C { static z = 0; static { C.z = plain(1) } } return C.z }`, 0, 0},
	"static-block-nested-block":   {`export effect function f() { class C { static z = 0; static { if (C.z === 0) { C.z = plain(1) } } } return C.z }`, 0, 0},
	"param-effect-function":       {`export effect function f(x = plain(1)) { return x }`, 1, 0},
	"param-effect-arrow":          {`export const f = effect (x = plain(1)) => x`, 1, 0},
	"param-effect-method":         {`export class M { effect m(x = plain(1)) { return x } }`, 1, 0},
	"param-effect-object-method":  {`export const o = { effect m(x = plain(1)) { return x } }`, 1, 0},
	"param-producer":              {`export effect function* f(x = plain(1)) { yield x }`, 1, 0},
	"param-destructuring-default": {`export effect function f({ a = plain(1) }: { a?: number } = {}) { return a }`, 1, 0},
	"param-plain-control":         {`export function f(x = plain(1)) { return x }`, 0, 0},
	"param-async-control":         {`export async function f(x = plain(1)) { return x }`, 0, 0},
	"param-nested-arrow-control":  {`export effect function f(g = () => plain(1)) { return g() }`, 0, 0},
	"computed-field-name-control": {"export effect function f() { class C { [String(plain(1))] = 2 } return C }", 0, 1},
	"plain-method-control":        {`export effect function f() { class C { m() { return plain(1) } } return new C().m() }`, 0, 0},
	"top-level-control":           {`export const v = plain(1)`, 0, 0},
}

func FuzzForeignCallContexts(f *testing.F) {
	startShortBudget(f)
	requireForeignCallContextQuotes(f)
	for key := range foreignCallContextForms {
		for mode := uint8(0); mode < 3; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		form, ok := foreignCallContextForms[key]
		if !ok {
			key, form = "field", foreignCallContextForms["field"]
		}
		source := form.source
		switch mode % 3 {
		case 1:
			source = strings.ReplaceAll(source, "plain(1)", "/* call */ plain( 1 ) /* plain(1) */")
		case 2:
			source = "// café 😀 plain(1) EK0403\n" + strings.ReplaceAll(source, "{ ", "{\n\t")
		}
		main := "import { plain, tagged, safe } from \"./k.js\"\n" + source + "\n"
		result, err := w.Compile(context.Background(), Project{Files: map[string]string{"main.vibe": main, "k.ts": foreignCallContextLibrary}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		ek0401, ek0403 := 0, 0
		for _, d := range result.Diagnostics {
			if d.Source() != "EK" {
				continue
			}
			switch d.Code() {
			case 401:
				ek0401++
			case 403:
				ek0403++
			}
		}
		if ek0401 != form.ek0401 || ek0403 != form.ek0403 {
			Gap(t, "FuzzForeignCallContexts", "foreign-context:"+key, "%s; %s; got %d EK0401 and %d EK0403, want %d and %d\n%s\n%v", foreignCallContextQuotes[0].quote, foreignCallContextQuotes[2].quote, ek0401, ek0403, form.ek0401, form.ek0403, main, result.Diagnostics)
		}
	})
}

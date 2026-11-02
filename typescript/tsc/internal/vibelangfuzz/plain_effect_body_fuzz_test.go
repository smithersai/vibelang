package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

// plainEffectBodyQuote is chapter 1's rule for a function's kind. A function
// without `effect` is plain however its body reads: building, casting or
// returning an Effect value in it does not make it an Effect function, so its
// JavaScript holds no generator and no Effect.gen or Effect.fn wrapper, and a
// call returns the value the body builds (alchemy-62: alchemy's effectClass, a
// plain arrow returning Object.assign(class {}, Effectable.Prototype(...)),
// compiled to Effect.fnUntraced before the VIP-1 flip, so `class X extends
// effectClass(...)` threw "superclass is not a constructor").
const plainEffectBodyQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."

// plainEffectBodyForms are plain function forms; BODY stands for an
// expression whose type is an Effect or holds one.
var plainEffectBodyForms = []struct{ key, source string }{
	{"expression-arrow", "export const f = () => BODY"},
	{"block-arrow", "export const f = () => { return BODY }"},
	{"declaration", "export function f() { return BODY }"},
	{"method", "export class C { m() { return BODY } }"},
	{"returned-arrow", "export const f = () => () => BODY"},
	{"array-callback", "export const f = (xs: ReadonlyArray<number>) => xs.map(() => BODY)"},
	{"cast-arrow", "export const f = ((impl?: unknown) => BODY) as any"},
	{"curried-conditional", "export const f: any = ((impl?: unknown) =>\n  impl === undefined ? (inner: unknown) => f(inner) : (BODY as unknown)) as any"},
}

// plainEffectBodyValues are Effect-typed expressions, or values whose static
// side is an Effect (Effectable.Prototype spread onto a class).
var plainEffectBodyValues = []struct{ key, source string }{
	{"succeed", "Effect.succeed(1)"},
	{"map", "Effect.map(Effect.succeed(1), (n) => n + 1)"},
	{"conditional", "(Math.random() > 2 ? Effect.succeed(1) : Effect.fail(\"no\"))"},
	{"prototype", "Effectable.Prototype({ label: \"fz\", evaluate: () => Effect.succeed(1) })"},
	{"class-assign", "Object.assign(class {}, Effect.succeed(1))"},
	{"class-prototype", "Object.assign(class {}, Effectable.Prototype({ label: \"alchemy/EffectClass\", evaluate: () => Effect.succeed(1) }))"},
}

// plainEffectBodyLowerings are the JavaScript an Effect function's body
// compiles to; none belongs in a plain function's output.
var plainEffectBodyLowerings = []string{"function*", "yield*", "Effect.gen(", "Effect_1.gen(", "fnUntraced", "Effect.fn(", "Effect_1.fn("}

// TestPlainEffectBodyQuoted checks the chapter 1 sentence
// FuzzPlainEffectBody cites (specTests in PACKAGE.ts).
func TestPlainEffectBodyQuoted(t *testing.T) {
	plainEffectBodyQuoted(t)
}

func plainEffectBodyQuoted(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), plainEffectBodyQuote) {
		tb.Fatalf("001-functions no longer says %q; update FuzzPlainEffectBody's quote", plainEffectBodyQuote)
	}
}

// FuzzPlainEffectBody compiles one Effect-valued body in one plain function
// form and checks that the function's JavaScript stays plain. The input is
// the key form:value (keyed corpus); other bytes pick both by index.
func FuzzPlainEffectBody(f *testing.F) {
	startShortBudget(f)
	plainEffectBodyQuoted(f)
	for _, form := range plainEffectBodyForms {
		for _, value := range plainEffectBodyValues {
			f.Add([]byte(form.key + ":" + value.key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		form, value := plainEffectBodyInput(data)
		key := "plain-effect-body:" + form.key + ":" + value.key
		source := "import { Effect } from \"effect\"\nimport * as Effectable from \"effect/Effectable\"\n" + strings.ReplaceAll(form.source, "BODY", value.source) + "\n"
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		if HasError(result.Diagnostics) {
			Gap(t, "FuzzPlainEffectBody", key, "001-functions: %q, so this plain function compiles as written\n%s\n%v", plainEffectBodyQuote, source, Keys(result.Dir, result.Diagnostics))
		}
		js, ok := result.Outputs["out/main.js"]
		if !ok && !result.EmitSkipped {
			t.Fatalf("no out/main.js among %v", mapKeys(result.Outputs))
		}
		for _, lowering := range plainEffectBodyLowerings {
			if strings.Contains(js, lowering) {
				Gap(t, "FuzzPlainEffectBody", key, "001-functions: %q; a function with no `effect` keyword compiled to an Effect function (%s):\n%s\nJavaScript:\n%s", plainEffectBodyQuote, lowering, source, js)
				break
			}
		}
		ExpectPending(t, "FuzzPlainEffectBody", key)
	})
}

// plainEffectBodyInput reads form:value, or picks both from the first two
// bytes.
func plainEffectBodyInput(data []byte) (struct{ key, source string }, struct{ key, source string }) {
	if formKey, valueKey, ok := strings.Cut(string(data), ":"); ok {
		for _, form := range plainEffectBodyForms {
			for _, value := range plainEffectBodyValues {
				if form.key == formKey && value.key == valueKey {
					return form, value
				}
			}
		}
	}
	var a, b byte
	if len(data) > 0 {
		a = data[0]
	}
	if len(data) > 1 {
		b = data[1]
	}
	return plainEffectBodyForms[int(a)%len(plainEffectBodyForms)], plainEffectBodyValues[int(b)%len(plainEffectBodyValues)]
}

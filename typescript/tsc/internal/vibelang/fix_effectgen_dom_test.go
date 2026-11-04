package vibelang

import (
	"strings"
	"testing"
)

const domHeadersGenerator = "import { Effect } from \"effect\"\nexport const make = Effect.fn(\"make\")(function*(input: Readonly<Record<string, string>>) { return new Headers(input) })\n"

func TestEffectGenPreservesDOMConstructor(t *testing.T) {
	result := fixProjectOf(t, map[string]string{"main.vibe": domHeadersGenerator})
	got := fixedText(result, "main.vibe")
	if result.Err != nil || strings.Contains(got, "Effect.fn") || strings.Contains(got, "function*") || !strings.Contains(got, "globalThis.Headers") {
		t.Fatalf("constructor conversion: err=%v refused=%+v\n%s", result.Err, result.Refused, got)
	}
}

func TestEffectGenDOMConstructorScope(t *testing.T) {
	for _, test := range []struct{ name, prefix, body string }{
		{"local", "", "const Headers = class { constructor(input: unknown) {} }; return new Headers(input)"},
		{"import", "import { Headers } from \"./native.js\"\n", "return new Headers(input)"},
		{"member", "", "const obj = { Headers: class { constructor(input: unknown) {} } }; return new obj.Headers(input)"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := test.prefix + strings.Replace(domHeadersGenerator, "return new Headers(input)", test.body, 1)
			result := fixProjectOf(t, map[string]string{"main.vibe": source, "native.ts": "export class Headers { constructor(input: unknown) {} }\n"})
			got := fixedText(result, "main.vibe")
			if result.Err != nil || strings.Contains(got, "globalThis.Headers") || strings.Contains(got, "function*") {
				t.Fatalf("binding changed: err=%v refused=%+v\n%s", result.Err, result.Refused, got)
			}
		})
	}
}

func TestEffectGenDOMConstructorShadowedGlobalThis(t *testing.T) {
	source := strings.Replace(domHeadersGenerator, "return new Headers(input)", "const globalThis = { Headers: class { constructor(input: unknown) {} } }; return new Headers(input)", 1)
	result := fixProjectOf(t, map[string]string{"main.vibe": source})
	got := fixedText(result, "main.vibe")
	if strings.Contains(got, "new globalThis.Headers") || !strings.Contains(got, "function*") {
		t.Fatalf("captured globalThis: %+v\n%s", result.Refused, got)
	}
}

func TestEffectGenDOMConstructorNested(t *testing.T) {
	for _, body := range []string{
		"return new (Headers)(input)",
		"const first = new Headers(input); const inner = Effect.gen(function*() { return new Headers(input) }); return inner",
		"return yield* Effect.succeed(new Headers(input))",
		"const make = () => new Headers(input); return make()",
	} {
		t.Run(body, func(t *testing.T) {
			result := fixProjectOf(t, map[string]string{"main.vibe": strings.Replace(domHeadersGenerator, "return new Headers(input)", body, 1)})
			got := fixedText(result, "main.vibe")
			if result.Err != nil || strings.Contains(got, "function*") || !strings.Contains(got, "globalThis.Headers") || strings.Contains(got, "globalThis.globalThis") {
				t.Fatalf("nested conversion: err=%v refused=%+v\n%s", result.Err, result.Refused, got)
			}
		})
	}
}

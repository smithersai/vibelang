package vibelang

import (
	"strings"
	"testing"
)

func TestEffectGenConstructorDefectBridge(t *testing.T) {
	const helper = "export const constructors = { Box: class { constructor(readonly value: string) {} } };\n"
	for _, test := range []struct {
		name, prefix, body string
		refuse             bool
	}{
		{"member", "", "if (value) new constructors.Box(value).value; return 1", false},
		{"alias", "const Box = constructors.Box\n", "if (value) new Box(value).value; return 1", false},
		{"returned", "", "return new constructors.Box(value).value", false},
		{"eval", "", "return new constructors.Box(eval('value')).value", true},
		{"yield", "", "return new constructors.Box(yield* Effect.succeed(value)).value", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "import { Effect } from 'effect'\nimport { constructors } from './foreign.js'\n" + test.prefix + "export const work = (value: string) => Effect.gen(function* () { " + test.body + " })\n"
			result := fixProjectOf(t, map[string]string{"main.vibe": source, "foreign.ts": helper})
			got := fixedText(result, "main.vibe")
			if got == "" {
				got = source
			}
			if result.Err != nil {
				t.Fatalf("fix error: %v", result.Err)
			}
			if test.refuse {
				if !strings.Contains(got, "Effect.gen") {
					t.Fatalf("unsafe constructor movement was accepted: refused=%+v\n%s", result.Refused, got)
				}
				return
			}
			if len(result.Refused) != 0 || strings.Contains(got, "Effect.gen") || !strings.Contains(got, "Effect.orDie(Effect.try({ try: () => new ") || !strings.Contains(got, "catch: (e) => e") {
				t.Fatalf("constructor defect was not preserved: refused=%+v\n%s\nsource:\n%s", result.Refused, got, source)
			}
		})
	}
}

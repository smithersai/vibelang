package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const dataMethodFixKey = "key:legacy-data-method\n"
const dataMethodRetirementQuote = "Data-type methods such as `x.map` on `Option` and `Stream` are among them."

func TestDataMethodFixQuoted(t *testing.T) {
	for _, item := range []struct{ chapter, quote string }{
		{"000-intro.md", dataMethodRetirementQuote},
		{"007-tooling.md", migrationDeclarationFixQuote},
	} {
		if !strings.Contains(SpecText(item.chapter), item.quote) {
			t.Fatalf("%s no longer says %q", item.chapter, item.quote)
		}
	}
}

// The retirement ruling requires a preserving namespace migration; Chapter 7
// requires evaluation order, coldness, types, comments and declaration output.
// FuzzFix already compares Exit and event traces and checks idempotence. Vary
// Some/None, module aliases/shadowing, receiver and argument factories, chains,
// comments, and pure/Effect/Stream receivers through that same oracle.
func dataMethodFixArchive(input string) string {
	data := []byte(strings.TrimPrefix(input, dataMethodFixKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	option, imports := "Option", ""
	switch pick(0) % 3 {
	case 1:
		option, imports = "O", "import * as O from \"effect/Option\"; const Option = 42;\n"
	case 2:
		option, imports = "Opt", "import * as Opt from \"effect/Option\";\n"
	}
	value := fmt.Sprintf("%s.some(%d)", option, int(pick(1))-128)
	if pick(2)&1 != 0 {
		value = option + ".none<number>()"
	}
	operation := fmt.Sprintf("const value = subject() /*receiver*/ . /*dot*/ map /*name*/ (/*argument*/ transform()).getOrElse(() => -1);")
	extra := ""
	switch pick(3) % 3 {
	case 1:
		extra = "const cold = Effect.succeed(3); const changed = cold.map((n) => { events.push(\"effect\"); return n + 2 }); const result = try changed; events.push(\"ran:\" + result);"
	case 2:
		extra = "const stream = Stream.make(1, 2).map((n) => { events.push(\"pull\"); return n * 2 }).take(1); const result = try Stream.runCollect(stream); events.push(\"collected:\" + result.join(\"-\"));"
	}
	// Keep the shadowed alias's module separate from the Effect/Stream
	// wrapper. Otherwise removing a synthetic Option prepend can reorder it
	// with another module's prelude imports: that belongs to the refusal
	// oracle in dataMethodImportOrderArchive, not this must-migrate oracle.
	subject := fmt.Sprintf(`%s
export function optionExample() {
 const events: string[] = [];
 function subject(): %s.Option<number> { events.push("receiver"); return %s; }
 function transform(): (n: number) => number { events.push("argument"); return (n) => { events.push("callback"); return n + 1 }; }
 %s
 return [value, events] as const;
}
`, imports, option, value, operation)
	main := fmt.Sprintf(`import { optionExample } from "./subject.js";
export effect function main() {
 const [value, events] = optionExample();
 %s
 return value + ":" + events.join(",");
}
`, extra)
	return Archive(map[string]string{"main.vibe": main, "subject.vibe": subject})
}

const dataMethodImportPhaseKey = "key:legacy-data-import-phase\n"

// Ordinary TypeScript import elision is inherited by VIP-14's modules.
// A reset module makes the phase observation deterministic in a reused Node
// worker. The bridge executes only if a formerly erased import becomes live.
func dataMethodImportPhaseArchive(input string) string {
	data := []byte(strings.TrimPrefix(input, dataMethodImportPhaseKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	alias := "O"
	if pick(0)&1 != 0 {
		alias = "Opt"
	}
	receiver := "value"
	if pick(2)&1 != 0 {
		receiver = alias + ".some(getOrElse(value, () => 0))"
	}
	source := fmt.Sprintf(`import "./reset.js"
import { Option as %s } from "./bridge.js"
import { some, getOrElse } from "effect/Option"
const Option = 42
export function update(value: %s.Option<number>) {
 let typeOnly: typeof %s | undefined
 return %s.map((n) => n + %d)
}
export effect function main() {
 const result = getOrElse(update(some(%d)), () => -1)
 const phase = try Effect.sync(() => globalThis.__vibeDataMethodPhase)
 return [result, phase]
}
`, alias, alias, alias, receiver, int(pick(3))-128, int(pick(1))-128)
	return Archive(map[string]string{
		"main.vibe": source,
		"reset.ts":  "export {}; declare global { var __vibeDataMethodPhase: number }; globalThis.__vibeDataMethodPhase = 0;\n",
		"bridge.ts": "export { Option } from \"effect\"; globalThis.__vibeDataMethodPhase = 1;\n",
	})
}

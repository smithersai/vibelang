package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const optionMatchFixKey = "key:direct-option-match\n"
const optionMatchFixTrigger = "An Effect `Match` chain with a supported finisher, or a direct `Option.match(value, handlers)` call"

func TestOptionMatchFixQuoted(t *testing.T) {
	for _, chapter := range []string{"007-tooling.md", "900-appendices.md"} {
		if !strings.Contains(SpecText(chapter), optionMatchFixTrigger) {
			t.Fatalf("%s no longer says %q", chapter, optionMatchFixTrigger)
		}
	}
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
}

// Chapter 7 requires the trigger above and says: "A quick fix is offered
// only when it preserves evaluation order, coldness, types, comments, and
// declaration output; otherwise the diagnostic explains why it has no
// automatic fix." FuzzFix compares the original and fixed program, returning
// both the value and its event trace through the existing outcome oracle.
// Vary imports, aliases, Some/None, payloads, callback defaults/early returns,
// handler construction and getter reads. No second runtime oracle is needed.
func optionMatchFixArchive(input string) string {
	data := []byte(strings.TrimPrefix(input, optionMatchFixKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	imports, option := `import { Option } from "effect"`, "Option"
	switch pick(0) % 3 {
	case 1:
		imports, option = `import * as O from "effect/Option"`, "O"
	case 2:
		imports, option = `import { Option as Opt } from "effect"`, "Opt"
	}
	valueType := "number"
	value := fmt.Sprintf("%s.some(%d)", option, int(pick(1))-128)
	if pick(2)&1 != 0 {
		value = option + ".none<number>()"
	}
	some := `(n: number): number => { events.push("some"); if (n < 0) return -n; return n + 1; }`
	if pick(3)&1 != 0 {
		some = `(n = do { events.push("default"); 7; }): number => { events.push("some-default"); return n + 2; }`
		if pick(5)&1 != 0 && pick(2)&1 == 0 {
			valueType = "number | undefined"
			value = option + ".some<number | undefined>(undefined)"
		}
	}

	// T3code slide-text: plain-marking can expose a later safe fix. Exercise
	// the exact object payload and local declaration in its block arm too.
	if pick(6)&1 != 0 {
		valueType = "{ n: number }"
		value = fmt.Sprintf("%s.some({ n: %d })", option, int(pick(1))-128)
		if pick(2)&1 != 0 {
			value = option + ".none<{ n: number }>()"
		}
		some = "(item: { n: number }): infer _ => { const n = item.n; events.push(\"some-object\"); return n + 1; }"
	}

	// Source annotations must name qualified payloads and complete record types.
	switch pick(7) % 3 {
	case 1:
		imports += "; import { DateTime } from \"effect\""
		valueType = "DateTime.Utc"
		value = "DateTime.make(\"2024-01-02T00:00:00Z\")"
		if pick(2)&1 != 0 {
			value = option + ".none<DateTime.Utc>()"
		}
		some = "(n): number => { events.push(\"some-date\"); return DateTime.toDateUtc(n).getUTCFullYear(); }"
	case 2:
		fields, values := []string{}, []string{}
		for i := 0; i < 24+int(pick(1)%17); i++ {
			fields = append(fields, fmt.Sprintf("p%d: number", i))
			values = append(values, fmt.Sprintf("p%d: %d", i, i))
		}
		valueType = "{" + strings.Join(fields, ";") + "}"
		value = option + ".some({" + strings.Join(values, ",") + "})"
		if pick(2)&1 != 0 {
			value = option + ".none<" + valueType + ">()"
		}
		some = "(n): number => { events.push(\"some-wide\"); return n.p0; }"
	}

	handlers := fmt.Sprintf(`{ onNone: (): number => { events.push("none"); return -1; }, onSome: %s }`, some)
	if pick(4)&1 != 0 {
		handlers = fmt.Sprintf(`{ get onNone(): () => number { events.push("read-none"); return (): number => { events.push("none"); return -1; }; }, get onSome(): (n: %s) => number { events.push("read-some"); return %s; } }`, valueType, some)
	}
	source := fmt.Sprintf(`%s
function choose(): string {
 const events: string[] = [];
 function subject(): %s.Option<%s> { events.push("subject"); return %s; }
 function handlers(): { onNone: () => number; onSome: (n: %s) => number } { events.push("handlers"); return %s; }
 const result = %s.match(subject(), handlers());
 return result + ":" + events.join(",");
}
export effect function main() { return choose(); }
`, imports, option, valueType, value, valueType, handlers, option)
	return Archive(map[string]string{"main.vibe": source})
}

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

	if len(data) > 13 && pick(12)&1 != 0 {
		return optionMatchContextArchive(imports, option, valueType, value, pick(13))
	}

	handlers := fmt.Sprintf(`{ onNone: (): number => { events.push("none"); return -1; }, onSome: %s }`, some)
	ignored := pick(8)&1 != 0
	symbolResult := len(data) > 10 && pick(10)&1 != 0
	resultType, noneBody, someEvent := "number", `events.push("none"); return -1;`, "some-ignored"
	symbolName := ""
	if symbolResult {
		ignored = true
		symbolName = []string{"a", "value", "$optionValue"}[int(pick(11))%3]
		resultType = "{ tag: typeof " + symbolName + " }"
		noneBody = `events.push("none"); return { tag: ` + symbolName + " };"
		someEvent = "some-symbol"
	}
	if ignored {
		result := "13"
		if symbolResult {
			result = "{ tag: " + symbolName + " }"
		}
		some = fmt.Sprintf(`(): %s => { events.push(%q); return %s; }`, resultType, someEvent, result)
		handlers = fmt.Sprintf(`{ onNone: (): %s => { %s }, onSome: %s }`, resultType, noneBody, some)
	}
	if pick(4)&1 != 0 {
		handlers = fmt.Sprintf(`{ get onNone(): () => number { events.push("read-none"); return (): number => { events.push("none"); return -1; }; }, get onSome(): (n: %s) => number { events.push("read-some"); return %s; } }`, valueType, some)
	}
	if ignored {
		if pick(4)&1 != 0 {
			handlers = fmt.Sprintf(`{ get onNone(): () => %s { events.push("read-none"); return (): %s => { %s }; }, get onSome(): () => %s { events.push("read-some"); return %s; } }`, resultType, resultType, noneBody, resultType, some)
		} else if pick(9)%3 == 1 {
			handlers = strings.Replace(handlers, "onSome: (): "+resultType+" =>", "onSome(): "+resultType, 1)
		} else if pick(9)%3 == 2 {
			handlers = strings.Replace(handlers, "onSome: (): "+resultType+" =>", "onSome: function(...ignored: []): "+resultType, 1)
			handlers = strings.Replace(handlers, fmt.Sprintf("events.push(%q)", someEvent), fmt.Sprintf("events.push(%q + ignored.length)", someEvent+"-argc:"), 1)
		}
	}
	handlerType := ": { onNone: () => number; onSome: (n: " + valueType + ") => number }"
	if ignored {
		handlerType = ""
	}
	source := fmt.Sprintf(`%s
function choose(): string {
 const events: string[] = [];
 function subject(): %s.Option<%s> { events.push("subject"); return %s; }
 function handlers()%s { events.push("handlers"); return %s; }
 const result = %s.match(subject(), handlers());
 return result + ":" + events.join(",");
}
export effect function main() { return choose(); }
`, imports, option, valueType, value, handlerType, handlers, option)
	if symbolResult {
		source = strings.Replace(source, " const events: string[] = [];", " const events: string[] = [];\n const "+symbolName+` = Symbol("tag");`, 1)
		source = strings.Replace(source, `return result + ":" + events.join(",");`, `return (result.tag === `+symbolName+` ? "tag:" : "bad:") + events.join(",");`, 1)
		source = strings.Replace(source, "export effect function main() { return choose(); }", "export function main() { return Effect.sync(choose); }", 1)
	}
	return Archive(map[string]string{"main.vibe": source})
}

// The original call supplies contextual result types even to nullary callbacks.
// Keep this in FuzzFix so its existing compile, contract and event oracle checks
// the repair rather than comparing two separately implemented runtime models.
func optionMatchContextArchive(imports, option, valueType, value string, mode byte) string {
	annotation, none, some := `"none" | "some"`, `"none"`, `"some"`
	setup, observed := "", "result"
	switch mode % 4 {
	case 1:
		annotation, none, some = `{ tag: "none" | "some" }`, `({ tag: "none" })`, `({ tag: "some" })`
		observed = "result.tag"
	case 2:
		setup, annotation = `const a = Symbol("tag");`, "{ tag: typeof a }"
		none, some = "({ tag: a })", "({ tag: a })"
		observed = `(result.tag === a ? "tag" : "bad")`
	case 3:
		annotation, some = `"none" | "unique symbol"`, `"unique symbol"`
	}
	source := fmt.Sprintf(`%s
function choose(): string {
 const events: string[] = [];
 %s
 function subject(): %s.Option<%s> { events.push("subject"); return %s; }
 const result: %s = %s.match(subject(), {
  onNone: () => { events.push("none"); return %s; },
  onSome: () => { events.push("some-context"); return %s; }
 });
 return %s + ":" + events.join(",");
}
export function main() { return Effect.sync(choose); }
`, imports, setup, option, valueType, value, annotation, option, none, some, observed)
	return Archive(map[string]string{"main.vibe": source})
}

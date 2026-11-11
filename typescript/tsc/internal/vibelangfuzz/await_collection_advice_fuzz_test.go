package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const awaitCollectionAdviceTarget = "FuzzAwaitCollectionAdvice"
const awaitCollectionAdviceQuote = "Every VibeLang diagnostic says what is wrong and how to fix it."
const awaitCollectionAdviceOperandQuote = "a `join` operand not assignable to `Fiber.Fiber<any, any>`"
const awaitCollectionAdvicePlacementQuote = "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block"

func TestAwaitCollectionAdviceQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", awaitCollectionAdviceQuote)
	chapterSays(t, "001-functions.md", awaitCollectionAdvicePlacementQuote)
	chapterSays(t, "002-running.md", awaitCollectionAdviceOperandQuote)
}

type awaitCollectionAdviceRule struct {
	key, source, config, note string
	effect                    bool
}

// The placement error is independent of operand type. Its optional repair
// must not suggest joining a collection that the join operand rule rejects.
func awaitCollectionAdviceRules() []awaitCollectionAdviceRule {
	hosts := []struct{ key, source string }{
		{"declaration", "export effect function f(){void (await EXPR)}"},
		{"expression", "export const f=effect function(){void (await EXPR)}"},
		{"arrow", "export const f=effect ()=>{void (await EXPR)}"},
		{"block", "export const f=effect {void (await EXPR)}"},
		{"producer", "export effect function* f(){void (await EXPR);yield 1}"},
		{"method", "export class C{effect f(){void (await EXPR)}}"},
		{"object-method", "export const o={effect f(){void (await EXPR)}}"},
		{"parameter", "export effect function f(value=await EXPR){void value}"},
		{"arrow-parameter", "export const f=effect (value=await EXPR)=>{void value}"},
		{"producer-parameter", "export effect function* f(value=await EXPR){yield value}"},
		{"static-nested", "export class C{static {void (()=>{void (effect ()=>{void (await EXPR)})})}}"},
		{"region", "export effect function f(){uninterruptible {void (await EXPR)}}"},
		{"concurrent", "export effect function f(){for concurrent(const n of [1]){void (await EXPR)}}"},
		{"do", "export effect function f(){const value=do{await EXPR;0};return value}"},
		{"async-control", "export async function f(){void (await EXPR)}"},
	}

	operands := []struct{ key, typ, note string }{
		{"array", "Fiber.Fiber<number>[]", ""},
		{"readonly-array", "ReadonlyArray<Fiber.Fiber<number>>", ""},
		{"tuple", "readonly [Fiber.Fiber<number>,Fiber.Fiber<string>]", ""},
		{"object", "{first:Fiber.Fiber<number>;second:Fiber.Fiber<string>}", ""},
		{"record", "Record<string,Fiber.Fiber<number>>", ""},
		{"any-array", "any[]", ""},
		{"iterable", "Iterable<Fiber.Fiber<number>>", ""},
		{"single", "Fiber.Fiber<number>", "Join the fiber"},
		{"single-union", "Fiber.Fiber<number>|Fiber.Fiber<string>", "Join the fiber"},
		{"fiber-array-intersection", "ReadonlyArray<Fiber.Fiber<number>>&Fiber.Fiber<number>", "Join the fiber"},
		{"deferred", "Deferred.Deferred<number>", "Wait for the Deferred"},
	}

	var rules []awaitCollectionAdviceRule
	for _, strict := range []bool{true, false} {
		mode := "strict"
		if !strict {
			mode = "loose"
		}
		config := fmt.Sprintf("{\"compilerOptions\":{\"strict\":%t,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}", strict)
		for _, host := range hosts {
			for _, operand := range operands {
				rules = append(rules, awaitCollectionAdviceRule{key: mode + "/" + host.key + "/" + operand.key, source: "import {Fiber,Deferred} from \"effect\";declare const input:" + operand.typ + ";" + strings.ReplaceAll(host.source, "EXPR", "input"), config: config, note: operand.note, effect: host.key != "async-control"})
			}
		}
	}
	return rules
}

func FuzzAwaitCollectionAdvice(f *testing.F) {
	startShortBudget(f)
	rules := awaitCollectionAdviceRules()
	for i, r := range rules {
		f.Add(r.key, uint8(i%4))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestAwaitCollectionAdviceQuoted(t)
		i := slices.IndexFunc(rules, func(r awaitCollectionAdviceRule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		r := rules[i]
		source := strings.Repeat("/* collection advice */\n", int(trivia)%4) + r.source
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: r.config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError || !IsEK(d) || d.Code() != 102 {
				continue
			}
			count++
			var messages []string
			for _, message := range d.MessageChain() {
				messages = append(messages, message.String())
			}
			text := strings.Join(messages, "\n")
			if r.note != "" {
				if !strings.Contains(text, r.note) {
					Gap(t, awaitCollectionAdviceTarget, r.key, "known handle lost repair %q: %s", r.note, text)
				}
			} else if strings.Contains(text, "Join the fiber") || strings.Contains(text, "Wait for the Deferred") {
				Gap(t, awaitCollectionAdviceTarget, r.key, "%s; collection invented a handle repair: %s", awaitCollectionAdviceQuote, text)
			}
		}
		want := 1
		if !r.effect {
			want = 0
		}
		if count != want {
			Gap(t, awaitCollectionAdviceTarget, r.key, "placement count %d, want %d: %s", count, want, source)
		}
		ExpectPending(t, awaitCollectionAdviceTarget, r.key)
		ExpectPending(t, awaitCollectionAdviceTarget, specCorpusKey(t))
	})
}

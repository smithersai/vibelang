package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const awaitHandleAdviceTarget = "FuzzAwaitHandleAdvice"
const awaitHandleAdviceQuote = "Every VibeLang diagnostic says what is wrong and how to fix it."
const awaitHandleAdvicePlacementQuote = "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block"
const awaitHandlePrelude = "import {Fiber,Deferred} from \"effect\";declare const fiber:Fiber.Fiber<number>;declare const deferred:Deferred.Deferred<number>;"

func TestAwaitHandleAdviceQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", awaitHandleAdviceQuote)
	chapterSays(t, "001-functions.md", awaitHandleAdvicePlacementQuote)
}

type awaitHandleAdviceRule struct {
	key, source, config, note string
	effect                    bool
}

// The placement error is independent of operand type. Its optional repair
// must not infer a handle from error recovery, unchecked or absent values.
func awaitHandleAdviceRules() []awaitHandleAdviceRule {
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

	operands := []struct{ key, source, note string }{
		{"missing", "missingValue", ""},
		{"property", "({n:1}).missingValue", ""},
		{"call", "missingCall()", ""},
		{"any", "(undefined as any)", ""},
		{"never", "(undefined as never)", ""},
		{"unknown", "(undefined as unknown)", ""},
		{"null", "null", ""},
		{"undefined", "undefined", ""},
		{"fiber", "fiber", "Join the fiber"},
		{"deferred", "deferred", "Wait for the Deferred"},
	}

	var rules []awaitHandleAdviceRule
	for _, strict := range []bool{true, false} {
		mode := "strict"
		if !strict {
			mode = "loose"
		}
		config := fmt.Sprintf("{\"compilerOptions\":{\"strict\":%t,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}", strict)
		for _, host := range hosts {
			for _, operand := range operands {
				rules = append(rules, awaitHandleAdviceRule{key: mode + "/" + host.key + "/" + operand.key, source: awaitHandlePrelude + strings.ReplaceAll(host.source, "EXPR", operand.source), config: config, note: operand.note, effect: host.key != "async-control"})
			}
		}
		for _, alias := range []struct{ key, typ, note string }{
			{"alias-any", "any", ""}, {"alias-never", "never", ""},
			{"alias-fiber", "Fiber.Fiber<number>", "Join the fiber"},
			{"alias-deferred", "Deferred.Deferred<number>", "Wait for the Deferred"},
			{"fiber-any-channel", "Fiber.Fiber<any>", "Join the fiber"},
			{"deferred-any-channel", "Deferred.Deferred<any>", "Wait for the Deferred"},
		} {
			source := awaitHandlePrelude + "type Handle=" + alias.typ + ";declare const value:Handle;export effect function f(){await value}"
			rules = append(rules, awaitHandleAdviceRule{key: mode + "/" + alias.key, source: source, config: config, note: alias.note, effect: true})
		}
	}
	return rules
}

func FuzzAwaitHandleAdvice(f *testing.F) {
	startShortBudget(f)
	rules := awaitHandleAdviceRules()
	for i, r := range rules {
		f.Add(r.key, uint8(i%4))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestAwaitHandleAdviceQuoted(t)
		i := slices.IndexFunc(rules, func(r awaitHandleAdviceRule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		r := rules[i]
		source := strings.Repeat("/* handle advice */\n", int(trivia)%4) + r.source
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
					Gap(t, awaitHandleAdviceTarget, r.key, "known handle lost repair %q: %s", r.note, text)
				}
			} else if strings.Contains(text, "Join the fiber") || strings.Contains(text, "Wait for the Deferred") {
				Gap(t, awaitHandleAdviceTarget, r.key, "%s; unresolved/unchecked operand invented a handle repair: %s", awaitHandleAdviceQuote, text)
			}
		}
		want := 1
		if !r.effect {
			want = 0
		}
		if count != want {
			Gap(t, awaitHandleAdviceTarget, r.key, "placement count %d, want %d: %s", count, want, source)
		}
		ExpectPending(t, awaitHandleAdviceTarget, r.key)
		ExpectPending(t, awaitHandleAdviceTarget, specCorpusKey(t))
	})
}

package vibelangfuzz

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
)

var nativeEnumAwaitQuotes = []string{"Class field and enum member initializers reset the Effect reservation context", "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."}

func requireNativeEnumAwaitQuotes(t testing.TB) {
	t.Helper()
	text := SpecText("001-functions.md") + SpecText("007-tooling.md")
	for _, q := range nativeEnumAwaitQuotes {
		if !strings.Contains(text, q) {
			t.Fatalf("missing native enum rule: %s", q)
		}
	}
}
func TestNativeEnumAwaitQuoted(t *testing.T) { requireNativeEnumAwaitQuotes(t) }

var nativeEnumAwaitHomes = []struct{ key, text string }{{"module", "export BODY"}, {"plain", "export function read(){BODY;return (Value.value as number)}"}, {"async", "export async function read(){BODY;return (Value.value as number)}"}, {"effect-function", "export effect function read(){BODY;return (Value.value as number)}"}, {"effect-expression", "export const read=effect function(){BODY;return (Value.value as number)}"}, {"effect-arrow", "export const read=effect ()=>{BODY;return (Value.value as number)}"}, {"effect-class", "export class Holder{effect read(){BODY;return (Value.value as number)}}"}, {"effect-object", "export const holder={effect read(){BODY;return (Value.value as number)}}"}, {"producer-function", "export effect function* read(){BODY;yield (Value.value as number)}"}, {"producer-expression", "export const read=effect function*(){BODY;yield (Value.value as number)}"}, {"producer-class", "export class Holder{effect *read(){BODY;yield (Value.value as number)}}"}, {"producer-object", "export const holder={effect *read(){BODY;yield (Value.value as number)}}"}}
var nativeEnumAwaitOperands = []struct{ key, text string }{{"promise", "promiseValue"}, {"scalar", "1"}, {"any", "(undefined as any)"}, {"unknown", "(undefined as unknown)"}, {"never", "(undefined as never)"}, {"thenable", "(undefined as unknown as PromiseLike<number>)"}, {"union", "(undefined as unknown as number | Promise<number>)"}, {"effect", "Effect.succeed(1)"}, {"missing", "missingValue"}}

func nativeEnumAwaitSource(key string, operand, variant uint8) (string, []string, string) {
	home := nativeEnumAwaitHomes[int(variant/2)%len(nativeEnumAwaitHomes)]
	for _, candidate := range nativeEnumAwaitHomes {
		if candidate.key == key {
			home = candidate
			break
		}
	}
	op := nativeEnumAwaitOperands[int(operand)%len(nativeEnumAwaitOperands)]
	modifier := ""
	if variant%2 != 0 {
		modifier = "const "
	}
	source := "import {Effect} from \"effect\";declare const promiseValue:Promise<number>;\n" + strings.Replace(home.text, "BODY", modifier+"enum Value{value=((await "+op.text+") as unknown as number)}", 1)
	want := []string{"TS1308"}
	if op.text[0] == '(' {
		want = []string{"TS2311"}
	}
	if variant%2 != 0 {
		want = append(want, "TS2474")
	}
	if op.key == "missing" {
		want = append(want, "TS2304")
	}
	slices.Sort(want)
	return source, want, fmt.Sprintf("%s/%s/const%t", home.key, op.key, variant%2 != 0)
}
func checkNativeEnumAwait(t *testing.T, w *Workspace, key string, operand, variant uint8) {
	t.Helper()
	source, want, precise := nativeEnumAwaitSource(key, operand, variant)
	result, err := w.Compile(context.Background(), Project{Files: map[string]string{"a.vibe": source, "package.json": "{\"type\":\"module\"}"}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["a.vibe"]}`})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	got := nativeAwaitOptionCodes(result)
	if !slices.Equal(got, want) {
		Gap(t, "FuzzNativeEnumAwait", precise, "stage=native-enum-grammar want=%v got=%v context=%v", want, got, nativeAwaitOptionContext(result))
	}
}
func TestNativeEnumAwaitRegression(t *testing.T) {
	requireNativeEnumAwaitQuotes(t)
	w := NewWorkspace(t)
	for _, home := range nativeEnumAwaitHomes {
		for op := uint8(0); int(op) < len(nativeEnumAwaitOperands); op++ {
			for variant := uint8(0); variant < 2; variant++ {
				_, _, key := nativeEnumAwaitSource(home.key, op, variant)
				t.Run(key, func(t *testing.T) { checkNativeEnumAwait(t, w, home.key, op, variant) })
			}
		}
	}
}
func FuzzNativeEnumAwait(f *testing.F) {
	startShortBudget(f)
	requireNativeEnumAwaitQuotes(f)
	for _, home := range nativeEnumAwaitHomes {
		for op := uint8(0); int(op) < len(nativeEnumAwaitOperands); op++ {
			for variant := uint8(0); variant < 2; variant++ {
				f.Add(home.key, op, variant)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, operand, variant uint8) {
		checkNativeEnumAwait(t, w, key, operand, variant)
	})
}

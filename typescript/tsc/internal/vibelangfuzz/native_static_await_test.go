package vibelangfuzz

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var nativeStaticAwaitQuotes = []struct{ chapter, text string }{
	{"001-functions.md", "a class field initializer and a `static` block are not effect code"},
	{"001-functions.md", "in an `async` function or at the module top level"},
	{"007-tooling.md", "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."},
}

func requireNativeStaticAwaitQuotes(t testing.TB) {
	t.Helper()
	for _, q := range nativeStaticAwaitQuotes {
		if !strings.Contains(SpecText(q.chapter), q.text) {
			t.Fatalf("missing native static-await rule: %s", q.text)
		}
	}
}
func TestNativeStaticAwaitQuoted(t *testing.T) { requireNativeStaticAwaitQuotes(t) }

var nativeStaticAwaitHomes = []struct{ key, text string }{
	{"module", "export class Value{static{BODY}}"},
	{"plain", "export function read(){class Value{static{BODY}};return 1}"},
	{"async", "export async function read(){class Value{static{BODY}};return 1}"},
	{"effect-function", "export effect function read(){class Value{static{BODY}};return 1}"},
	{"effect-expression", "export const read=effect function(){class Value{static{BODY}};return 1}"},
	{"effect-arrow", "export const read=effect()=>{class Value{static{BODY}};return 1}"},
	{"effect-class", "export class Holder{effect read(){class Value{static{BODY}};return 1}}"},
	{"effect-object", "export const holder={effect read(){class Value{static{BODY}};return 1}}"},
	{"producer-function", "export effect function* read(){class Value{static{BODY}};yield 1}"},
	{"producer-expression", "export const read=effect function*(){class Value{static{BODY}};yield 1}"},
	{"producer-class", "export class Holder{effect *read(){class Value{static{BODY}};yield 1}}"},
	{"producer-object", "export const holder={effect *read(){class Value{static{BODY}};yield 1}}"},
}
var nativeStaticAwaitOperands = []struct{ key, text string }{
	{"effect", "Effect.succeed(1)"},
	{"effect-union", "(undefined as unknown as Effect.Effect<number> | number)"},
	{"promise", "Promise.resolve(1)"},
	{"scalar", "1"},
	{"any", "(undefined as any)"},
	{"unknown", "(undefined as unknown)"},
	{"never", "(undefined as never)"},
	{"missing", "missingValue"},
}

func nativeStaticAwaitSource(key string, operand, variant uint8) (string, []string, string) {
	home := nativeStaticAwaitHomes[int(variant/4)%len(nativeStaticAwaitHomes)]
	for _, candidate := range nativeStaticAwaitHomes {
		if candidate.key == key {
			home = candidate
			break
		}
	}
	op := nativeStaticAwaitOperands[int(operand)%len(nativeStaticAwaitOperands)]
	shape := variant % 4
	body := "await " + op.text
	want := []string{"TS18037"}
	switch shape {
	case 1:
		body = "const value=await " + op.text + ";void value"
	case 2:
		body = "if(true){await " + op.text + "}"
	case 3:
		body = "const read=async()=>await " + op.text + ";void read"
		want = nil
		if op.key == "effect" || op.key == "effect-union" {
			want = []string{"EK0103"}
		}
	}
	if op.key == "missing" {
		want = append(want, "TS2304")
	}
	slices.Sort(want)
	source := "import {Effect} from \"effect\";" + strings.Replace(home.text, "BODY", body, 1)
	return source, want, fmt.Sprintf("%s/%s/shape%d", home.key, op.key, shape)
}

// This rule compares errors; independent advisory diagnostics remain visible.
func nativeStaticAwaitErrorCodes(result *Result) []string {
	codes := []string{}
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		prefix := d.Source()
		if prefix == "" {
			prefix = "TS"
		}
		codes = append(codes, diagnosticCodeName(prefix, d.Code()))
	}
	slices.Sort(codes)
	return codes
}

func checkNativeStaticAwait(t *testing.T, w *Workspace, key string, operand, variant uint8) {
	t.Helper()
	source, want, precise := nativeStaticAwaitSource(key, operand, variant)
	result, err := w.Compile(context.Background(), Project{Files: map[string]string{"a.vibe": source, "package.json": "{\"type\":\"module\"}"}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["a.vibe"]}`})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	if got := nativeStaticAwaitErrorCodes(result); !slices.Equal(got, want) {
		Gap(t, "FuzzNativeStaticAwait", precise, "stage=native-static-placement want=%v got=%v context=%v", want, got, nativeAwaitOptionContext(result))
	}
}
func TestNativeStaticAwaitRegression(t *testing.T) {
	requireNativeStaticAwaitQuotes(t)
	w := NewWorkspace(t)
	for _, home := range nativeStaticAwaitHomes {
		for op := uint8(0); int(op) < len(nativeStaticAwaitOperands); op++ {
			for variant := uint8(0); variant < 4; variant++ {
				_, _, key := nativeStaticAwaitSource(home.key, op, variant)
				t.Run(key, func(t *testing.T) { checkNativeStaticAwait(t, w, home.key, op, variant) })
			}
		}
	}
}
func FuzzNativeStaticAwait(f *testing.F) {
	startShortBudget(f)
	requireNativeStaticAwaitQuotes(f)
	for _, home := range nativeStaticAwaitHomes {
		for op := uint8(0); int(op) < len(nativeStaticAwaitOperands); op++ {
			for variant := uint8(0); variant < 4; variant++ {
				if op < 2 || variant == 0 {
					f.Add(home.key, op, variant)
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, operand, variant uint8) {
		checkNativeStaticAwait(t, w, key, operand, variant)
	})
}

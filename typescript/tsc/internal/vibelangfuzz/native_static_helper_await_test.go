package vibelangfuzz

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var staticHelperAwaitQuotes = []struct{ chapter, text string }{
	{"001-functions.md", "a class field initializer and a `static` block are not effect code"},
	{"001-functions.md", "in an `async` function or at the module top level"},
	{"007-tooling.md", "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."},
}

func requireStaticHelperAwaitQuotes(t testing.TB) {
	t.Helper()
	for _, q := range staticHelperAwaitQuotes {
		if !strings.Contains(SpecText(q.chapter), q.text) {
			t.Fatalf("missing native static-await rule: %s", q.text)
		}
	}
}
func TestStaticHelperAwaitQuoted(t *testing.T) { requireStaticHelperAwaitQuotes(t) }

var staticHelperAwaitHomes = []struct{ key, text string }{
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
var staticHelperAwaitOperands = []struct{ key, text string }{
	{"promise", "Promise.resolve(1)"},
	{"scalar", "1"},
	{"any", "(undefined as any)"},
	{"unknown", "(undefined as unknown)"},
	{"never", "(undefined as never)"},
	{"missing", "missingValue"},
	{"effect", "Effect.succeed(1)"},
	{"effect-union", "(undefined as unknown as Effect.Effect<number>|number)"},
}

func staticHelperAwaitSource(key string, operand, variant uint8) (string, []string, string) {
	home := staticHelperAwaitHomes[int(variant/4)%len(staticHelperAwaitHomes)]
	for _, candidate := range staticHelperAwaitHomes {
		if candidate.key == key {
			home = candidate
			break
		}
	}
	op := staticHelperAwaitOperands[int(operand)%len(staticHelperAwaitOperands)]
	shape := variant % 4
	body := "await " + op.text
	want := []string{"TS18037"}
	switch shape {
	case 1:
		body = "void(do{await " + op.text + ";0})"
	case 2:
		body = "void(match(1){default:await " + op.text + ";})"
	case 3:
		body = "void(async()=>match(1){default:await " + op.text + ";})"
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
func staticHelperAwaitErrorCodes(result *Result) []string {
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

func checkStaticHelperAwait(t *testing.T, w *Workspace, key string, operand, variant uint8) {
	t.Helper()
	source, want, precise := staticHelperAwaitSource(key, operand, variant)
	result, err := w.Compile(context.Background(), Project{Files: map[string]string{"a.vibe": source, "package.json": "{\"type\":\"module\"}"}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["a.vibe"]}`})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	if got := staticHelperAwaitErrorCodes(result); !slices.Equal(got, want) {
		Gap(t, "FuzzStaticHelperAwait", precise, "stage=native-static-placement want=%v got=%v context=%v", want, got, nativeAwaitOptionContext(result))
	}
}
func TestStaticHelperAwaitRegression(t *testing.T) {
	requireStaticHelperAwaitQuotes(t)
	w := NewWorkspace(t)
	for _, home := range staticHelperAwaitHomes {
		for op := uint8(0); int(op) < len(staticHelperAwaitOperands); op++ {
			for variant := uint8(0); variant < 4; variant++ {
				_, _, key := staticHelperAwaitSource(home.key, op, variant)
				t.Run(key, func(t *testing.T) { checkStaticHelperAwait(t, w, home.key, op, variant) })
			}
		}
	}
}
func FuzzStaticHelperAwait(f *testing.F) {
	startShortBudget(f)
	requireStaticHelperAwaitQuotes(f)
	for _, home := range staticHelperAwaitHomes {
		for op := uint8(0); int(op) < len(staticHelperAwaitOperands); op++ {
			for variant := uint8(0); variant < 4; variant++ {
				if op == 0 {
					f.Add(home.key, op, variant)
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, operand, variant uint8) {
		checkStaticHelperAwait(t, w, key, operand, variant)
	})
}

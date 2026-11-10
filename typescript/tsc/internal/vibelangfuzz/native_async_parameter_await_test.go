package vibelangfuzz

import (
	"context"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

var nativeAsyncParameterQuotes = []struct{ chapter, text string }{
	{"001-functions.md", "the innermost enclosing function, as for `await` in JavaScript"},
	{"001-functions.md", "in an `async` function or at the module top level"},
	{"007-tooling.md", "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."},
}

func requireNativeAsyncParameterQuotes(t testing.TB) {
	t.Helper()
	for _, q := range nativeAsyncParameterQuotes {
		if !strings.Contains(SpecText(q.chapter), q.text) {
			t.Fatalf("missing native parameter-await rule: %s", q.text)
		}
	}
}
func TestNativeAsyncParameterAwaitQuoted(t *testing.T) { requireNativeAsyncParameterQuotes(t) }

var asyncParameterHomes = []struct{ key, text string }{
	{"declaration", "export async function read(PARAM){return 1}"},
	{"expression", "export const read=async function(PARAM){return 1}"},
	{"arrow", "export const read=async(PARAM)=>1"},
	{"class-method", "export class Holder{async read(PARAM){return 1}}"},
	{"object-method", "export const holder={async read(PARAM){return 1}}"},
	{"generator", "export async function* read(PARAM){yield 1}"},
	{"generator-method", "export class Holder{async *read(PARAM){yield 1}}"},
	{"generator-object", "export const holder={async *read(PARAM){yield 1}}"},
}
var asyncParameterOperands = []struct{ key, text string }{
	{"effect", "Effect.succeed(1)"},
	{"effect-union", "(undefined as unknown as Effect.Effect<number>|number)"},
	{"promise", "Promise.resolve(1)"}, {"scalar", "1"}, {"any", "(undefined as any)"},
	{"unknown", "(undefined as unknown)"}, {"never", "(undefined as never)"}, {"missing", "missingValue"},
}

func asyncParameterSource(home, op string, shape int) string {
	param := "value=await " + op
	switch shape {
	case 1:
		param = "{value=await " + op + "}={}"
	case 2:
		param = "[value=await " + op + "]=[]"
	case 3:
		param = "value=(true?await " + op + ":1)"
	}
	return "import {Effect} from \"effect\";" + strings.Replace(home, "PARAM", param, 1)
}

func checkNativeAsyncParameterAwait(t *testing.T, w *Workspace, key string, operand, variant uint8) {
	t.Helper()
	home := asyncParameterHomes[int(variant/5)%len(asyncParameterHomes)]
	for _, h := range asyncParameterHomes {
		if h.key == key {
			home = h
			break
		}
	}
	op := asyncParameterOperands[int(operand)%len(asyncParameterOperands)]
	shape := int(variant % 5)
	source := asyncParameterSource(home.text, op.text, shape)
	want := []string{"TS2524"}
	if shape == 4 {
		source = "import {Effect} from \"effect\";" + strings.Replace(home.text, "PARAM", "value=async()=>await "+op.text, 1)
		want = nil
		if op.key == "effect" || op.key == "effect-union" {
			want = []string{"EK0103"}
		}
	}
	if op.key == "missing" {
		want = append(want, "TS2304")
	}
	slices.Sort(want)
	result, err := w.Compile(context.Background(), Project{Files: map[string]string{"a.vibe": source, "package.json": "{\"type\":\"module\"}"}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["a.vibe"]}`})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var got []string
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		prefix := d.Source()
		if prefix == "" {
			prefix = "TS"
		}
		got = append(got, diagnosticCodeName(prefix, d.Code()))
	}
	slices.Sort(got)
	if !slices.Equal(got, want) {
		Gap(t, "FuzzNativeAsyncParameterAwait", fmt.Sprintf("%s/%s/shape%d", home.key, op.key, shape), "want=%v got=%v", want, got)
	}
}
func TestNativeAsyncParameterAwaitRegression(t *testing.T) {
	requireNativeAsyncParameterQuotes(t)
	w := NewWorkspace(t)
	for _, h := range asyncParameterHomes {
		for op := range uint8(len(asyncParameterOperands)) {
			for v := range uint8(5) {
				t.Run(fmt.Sprintf("%s/%s/shape%d", h.key, asyncParameterOperands[op].key, v), func(t *testing.T) { checkNativeAsyncParameterAwait(t, w, h.key, op, v) })
			}
		}
	}
}
func FuzzNativeAsyncParameterAwait(f *testing.F) {
	startShortBudget(f)
	requireNativeAsyncParameterQuotes(f)
	for _, h := range asyncParameterHomes {
		for op := range uint8(len(asyncParameterOperands)) {
			f.Add(h.key, op, uint8(0))
			if op < 2 {
				f.Add(h.key, op, uint8(4))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, op, v uint8) { checkNativeAsyncParameterAwait(t, w, key, op, v) })
}

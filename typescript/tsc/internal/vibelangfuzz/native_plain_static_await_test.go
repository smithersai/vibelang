package vibelangfuzz

import (
	"context"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

var plainStaticAwaitQuotes = []struct{ chapter, text string }{
	{"001-functions.md", "a plain arrow written inside an `effect` function is a plain function"},
	{"007-tooling.md", "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."},
}

func requirePlainStaticAwaitQuotes(t testing.TB) {
	t.Helper()
	for _, q := range plainStaticAwaitQuotes {
		if !strings.Contains(SpecText(q.chapter), q.text) {
			t.Fatalf("missing plain static await rule: %s", q.text)
		}
	}
}
func TestPlainStaticAwaitQuoted(t *testing.T) { requirePlainStaticAwaitQuotes(t) }

var plainStaticAwaitHomes = []struct{ key, text string }{
	{"module", "export class Value{static{INNER}}"},
	{"async", "export async function outer(){class Value{static{INNER}};return 1}"},
	{"effect", "export effect function outer(){class Value{static{INNER}};return 1}"},
	{"producer", "export effect function* outer(){class Value{static{INNER}};yield 1}"},
}
var plainStaticAwaitFunctions = []struct{ key, text string }{
	{"arrow", "void(()=>{BODY})"},
	{"function", "void(function(){BODY})"},
	{"generator", "void(function*(){BODY})"},
	{"object-method", "void({read(){BODY}})"},
	{"class-method", "void(class Inner{read(){BODY}})"},
	{"getter", "void({get value(){BODY;return 1}})"},
	{"constructor", "void(class Inner{constructor(){BODY}})"},
}
var plainStaticAwaitOperands = []struct{ key, text string }{
	{"promise", "Promise.resolve(1)"}, {"scalar", "1"}, {"any", "(undefined as any)"}, {"unknown", "(undefined as unknown)"}, {"never", "(undefined as never)"}, {"missing", "missingValue"},
}

func checkPlainStaticAwait(t *testing.T, w *Workspace, key string, operand, variant uint8) {
	t.Helper()
	home := plainStaticAwaitHomes[int(variant/3)%len(plainStaticAwaitHomes)]
	fn := plainStaticAwaitFunctions[int(variant/12)%len(plainStaticAwaitFunctions)]
	for _, h := range plainStaticAwaitHomes {
		for _, f := range plainStaticAwaitFunctions {
			if h.key+":"+f.key == key {
				home = h
				fn = f
			}
		}
	}
	op := plainStaticAwaitOperands[int(operand)%len(plainStaticAwaitOperands)]
	body := "void(await " + op.text + ");"
	want := []string{"TS1308"}
	if op.key == "any" || op.key == "unknown" || op.key == "never" {
		want = []string{"TS2311"}
	}
	switch variant % 3 {
	case 1:
		body = "void(async()=>await " + op.text + ");"
		want = nil
	case 2:
		body = "void(effect()=>{return try Effect.tryPromise(()=>Promise.resolve(" + op.text + "))});"
		want = nil
	}
	if op.key == "missing" {
		want = append(want, "TS2304")
	}
	slices.Sort(want)
	source := "export {};" + strings.Replace(home.text, "INNER", strings.Replace(fn.text, "BODY", body, 1), 1)
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
		Gap(t, "FuzzPlainStaticAwait", fmt.Sprintf("%s:%s/%s/shape%d", home.key, fn.key, op.key, variant%3), "want=%v got=%v", want, got)
	}
}
func TestPlainStaticAwaitRegression(t *testing.T) {
	requirePlainStaticAwaitQuotes(t)
	w := NewWorkspace(t)
	for _, h := range plainStaticAwaitHomes {
		for _, fn := range plainStaticAwaitFunctions {
			for op := range uint8(len(plainStaticAwaitOperands)) {
				for v := range uint8(3) {
					t.Run(fmt.Sprintf("%s:%s/%s/shape%d", h.key, fn.key, plainStaticAwaitOperands[op].key, v), func(t *testing.T) { checkPlainStaticAwait(t, w, h.key+":"+fn.key, op, v) })
				}
			}
		}
	}
}
func FuzzPlainStaticAwait(f *testing.F) {
	startShortBudget(f)
	requirePlainStaticAwaitQuotes(f)
	for _, h := range plainStaticAwaitHomes {
		for _, fn := range plainStaticAwaitFunctions {
			for v := range uint8(3) {
				f.Add(h.key+":"+fn.key, uint8(0), v)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, op, v uint8) { checkPlainStaticAwait(t, w, key, op, v) })
}

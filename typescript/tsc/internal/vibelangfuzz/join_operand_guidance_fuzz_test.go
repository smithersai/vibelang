package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestJoinOperandGuidanceQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "a \x60join\x60 operand not assignable to \x60Fiber.Fiber<any, any>\x60")
	chapterSays(t, "002-running.md", "A call that may throw, and a Promise, must first be wrapped with \x60Effect.try\x60, \x60tryPromise\x60 or \x60promise\x60")
	chapterSays(t, "003-failures.md", "In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited.")
	chapterSays(t, "007-tooling.md", "including independent errors in embedded expressions and types.")
	chapterSays(t, "002-running.md", "The Effect-body forms \x60join fiber\x60 and \x60try Deferred.await(deferred)\x60")
}

// The suggested expression must be legal Effect execution with the native
// API's channels. This is a static oracle; rejected join inputs never run.
func FuzzJoinOperandGuidance(f *testing.F) {
	startShortBudget(f)
	rows := []struct{ key, typ, native string }{
		{"deferred", "Deferred.Deferred<number,string>", "Deferred.await(OPERAND)"},
		{"deferred-never", "Deferred.Deferred<number>", "Deferred.await(OPERAND)"},
		{"promise", "Promise<number>", "Effect.tryPromise(() => OPERAND)"},
		{"thenable", "PromiseLike<number>", "Effect.tryPromise(() => OPERAND)"},
		{"effect", "Effect.Effect<number,string>", "OPERAND"},
		{"effect-subtype", "Effect.Effect<number,string>&{readonly brand:true}", "OPERAND"},
		{"config", "Config.Config<number>", "OPERAND"},
		{"exit", "Exit.Exit<number,string>", "OPERAND"},
		{"deferred-marker", "{readonly \"~effect/Deferred\":unknown}", ""},
		{"effect-marker", "{readonly \"~effect/Effect\":unknown}", ""},
	}
	for _, row := range rows {
		for _, flags := range []byte{0, 1, 2, 3, 4, 8} {
			f.Add(row.key, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags byte) {
		TestJoinOperandGuidanceQuoted(t)
		i := slices.IndexFunc(rows, func(r struct{ key, typ, native string }) bool { return r.key == key })
		if i < 0 {
			i = 0
			for _, b := range []byte(key) {
				i = (i*31 + int(b)) % len(rows)
			}
		}
		row := rows[i]
		operand := []string{"input", "(/* café 😀 */ input)", "(input satisfies unknown)", "pick()"}[flags%4]
		typ := row.typ
		alias := ""
		if flags&4 != 0 {
			alias = "type Input=" + typ + ";"
			typ = "Input"
		}
		prefix := "import {Deferred,Effect,Config,Exit} from \"effect\";" + alias + "declare const input:" + typ + ";function pick(){return input}\n"
		config := DefaultConfig
		if flags&8 != 0 {
			var options map[string]any
			if err := json.Unmarshal([]byte(config), &options); err != nil {
				t.Fatal(err)
			}
			options["vibe"] = map[string]any{"effectModules": false}
			data, err := json.Marshal(options)
			if err != nil {
				t.Fatal(err)
			}
			config = string(data)
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": prefix + "export effect function actual(){return join " + operand + "}"}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := r3Errors(result.Diagnostics)
		want := []string{"EK1704"}
		if flags%4 == 3 && (row.key == "promise" || row.key == "thenable") {
			want = append(want, "EK0404")
		}
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzJoinOperandGuidance", fmt.Sprintf("%s:%d", row.key, flags&15), "invalid join operand and independent errors want %v, got %v", want, got)
			return
		}
		recipe := ""
		for _, d := range result.Diagnostics {
			if d.Code() != 1704 {
				continue
			}
			for _, child := range d.MessageChain() {
				if i := strings.Index(child.MessageText(), "try "); i >= 0 {
					recipe = strings.TrimSuffix(strings.TrimSpace(child.MessageText()[i:]), ".")
				}
			}
		}
		if row.native == "" {
			if recipe != "" {
				Gap(t, "FuzzJoinOperandGuidance", row.key, "an incomplete marker received a runnable handle recipe: %s", recipe)
			}
			return
		}
		if recipe == "" {
			Gap(t, "FuzzJoinOperandGuidance", row.key, "diagnostic gives no executable Effect recipe")
			return
		}
		expected := strings.ReplaceAll(row.native, "OPERAND", operand)
		source := prefix + "export effect function actual(){return " + recipe + "}\n" +
			"export function native(){return Effect.gen(function*(){return yield* " + expected + "})}\n" +
			"const forward:typeof native=actual;const backward:typeof actual=native;void forward;void backward;"
		fixed, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer fixed.Remove()
		if got := r3Errors(fixed.Diagnostics); len(got) != 0 {
			Gap(t, "FuzzJoinOperandGuidance", fmt.Sprintf("%s:%d", row.key, flags&15), "printed recipe fails native API identity: %v\n%s", got, source)
		}
	})
}

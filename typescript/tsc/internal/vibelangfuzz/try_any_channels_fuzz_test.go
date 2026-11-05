package vibelangfuzz

import (
	"fmt"
	"slices"
	"testing"
)

func TestTryAnyChannelsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "each export's type identical to \x60tsc\x60's in both directions (a type-level check)")
}

func FuzzTryAnyChannels(f *testing.F) {
	startShortBudget(f)
	rows := []struct{ key, declarations, operand, prefix string }{
		{"stored", "declare const input:any;", "input", ""},
		{"direct", "declare function input():any;", "input()", ""},
		{"return-alias", "type Unchecked=any;declare function input():Unchecked;", "input()", ""},
		{"callable", "declare const input:()=>any;", "input()", ""},
		{"optional-call", "declare const input:(()=>any)|undefined;", "input?.()", ""},
		{"method", "declare const input:{load():any};", "input.load()", ""},
		{"element-call", "declare const input:{load():any};", "input[\"load\"]()", ""},
		{"parenthesized-callee", "declare function input():any;", "(input)()", ""},
		{"generic-call", "declare function input<T>():any;", "input<number>()", ""},
		{"property-value", "declare const input:{value:any};", "input.value", ""},
		{"conditional-call", "declare const choose:boolean;declare function left():any;declare function right():any;", "(choose ? left : right)()", ""},
		{"local-factory", "declare const value:any;function input(){return value}", "input()", ""},
		{"direct-after-any-effect", "declare function input():any;declare const pending:Effect.Effect<any,any,any>;", "input()", "pending"},
		{"stored-after-any-effect", "declare const input:any;declare const pending:Effect.Effect<any,any,any>;", "input", "pending"},
	}
	for _, row := range rows {
		for flags := byte(0); flags < 8; flags++ {
			f.Add(row.key, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags byte) {
		TestTryAnyChannelsQuoted(t)
		i := slices.IndexFunc(rows, func(row struct{ key, declarations, operand, prefix string }) bool { return row.key == key })
		if i < 0 {
			i = 0
			for _, b := range []byte(key) {
				i = (i*31 + int(b)) % len(rows)
			}
		}
		row := rows[i]
		operand := row.operand
		if flags&1 != 0 {
			operand = "(/* operand */ " + operand + ")"
		}
		if flags&2 != 0 {
			operand = "(" + operand + " as any)"
		}
		nativePrefix, vibePrefix := "", ""
		if flags&4 != 0 {
			nativePrefix = "yield* Effect.succeed(1);"
			vibePrefix = "try Effect.succeed(1);"
		}
		if row.prefix != "" {
			nativePrefix += "yield* " + row.prefix + ";"
			vibePrefix += "try " + row.prefix + ";"
		}
		source := row.declarations +
			"\nexport function native(){return Effect.gen(function*(){" + nativePrefix + "return yield* " + operand + "})}" +
			"\nexport effect function actual(){" + vibePrefix + "return try " + operand + "}" +
			"\nconst forward:typeof native=actual;const backward:typeof actual=native;void forward;void backward;"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: DefaultConfig})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		if errors := r3Errors(result.Diagnostics); len(errors) != 0 {
			Gap(t, "FuzzTryAnyChannels", fmt.Sprintf("%s:%d", row.key, flags%8), "native yield* API identity wants no errors, got %v", errors)
		}
	})
}

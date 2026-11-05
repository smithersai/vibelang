package vibelangfuzz

import (
	"fmt"
	"testing"
)

// Reuse FuzzFix's runtime event, contract, comment and fixed-point oracles.
// Chapter 007's preservation quote is checked by TestOptionMatchFixQuoted.
func FuzzOptionMatchProgramFix(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"\x00\x00\x00\x00\x00\x00\x00\x00\x01", "\x01\x07\x01\x00\x01\x00\x00\x00\x01", "\x02\xff\x00\x01\x01\x00\x00\x00\x01", "\x00\x03\x00\x00\x00\x01\x00\x00\x01", "\x01\x05\x01\x00\x01\x02\x00\x00\x01", "\x02\x09\x00\x00\x00\x02\x00\x00\x01"} {
		f.Add(optionMatchFixKey + key)
	}
	for mode := byte(0); mode < 3; mode++ {
		for variant := byte(0); variant < 2; variant++ {
			f.Add(optionMatchFixKey + "program-constructor:" + string([]byte{mode, 7, variant, 0, variant, mode}))
		}
	}
	fuzzFixProjects(f, "FuzzOptionMatchProgramFix")
}

func optionMatchProgramFixArchive(data []byte) string {
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	option, imports := "Option", "import { Option, Effect } from \"effect\""
	if pick(0)%3 == 1 {
		option, imports = "O", "import * as O from \"effect/Option\"; import { Effect } from \"effect\""
	}
	if pick(0)%3 == 2 {
		option, imports = "Opt", "import { Option as Opt, Effect } from \"effect\""
	}
	value := fmt.Sprintf("%s.some(%d)", option, pick(1))
	if pick(2)&1 != 0 {
		value = option + ".none<number>()"
	}
	// Defaults, branches and comments remain inside the original callbacks.
	some := "(n: number): Effect.Effect<number> => { events.push(\"some\"); /* payload stays cold */ return Effect.sync(() => { events.push(\"run-some\"); return n; }); }"
	none := "(): Effect.Effect<number> => { events.push(\"none\"); return Effect.sync(() => { events.push(\"run-none\"); return -1; }); }"
	// A generic constructor is already a callable program factory. Keep
	// its inference and call timing, including when read through a getter.
	if len(data) > 9 && data[9]&1 != 0 {
		some = "Effect.succeed"
	}
	handlers := "{ onNone: " + none + ", onSome: " + some + " }"
	if pick(4)&1 != 0 {
		handlers = "{ get onNone(): () => Effect.Effect<number> { events.push(\"read-none\"); return " + none + "; }, get onSome(): (n: number) => Effect.Effect<number> { events.push(\"read-some\"); return " + some + "; } }"
	}
	run := "const program = choose(); events.push(\"chosen\"); const a = try program; const b = try program;"
	if pick(3)&1 != 0 {
		run = "const a = try choose(); events.push(\"between\"); const b = try choose();"
	}
	// The choice's own try: returned, or a statement whose result is dropped.
	choose := fmt.Sprintf("export function choose() { return %s.match(subject(), handlers()); }", option)
	switch pick(5) % 3 {
	case 1:
		choose = fmt.Sprintf("export effect function choose() { return try %s.match(subject(), handlers()); }", option)
		run = "const a = try choose(); events.push(\"between\"); const b = try choose();"
	case 2:
		choose = fmt.Sprintf("export effect function choose() { try %s.match(subject(), handlers()); events.push(\"after\"); return 0; }", option)
		run = "const a = try choose(); events.push(\"between\"); const b = try choose();"
	}
	source := fmt.Sprintf(`%s
const events: string[] = [];
function subject(): %s.Option<number> { events.push("subject"); return %s; }
function handlers() { events.push("handlers"); return %s; }
%s
export effect function main() {
 %s
 return [a, b, events.join(",")];
}
`, imports, option, value, handlers, choose, run)
	return Archive(map[string]string{"main.vibe": source})
}

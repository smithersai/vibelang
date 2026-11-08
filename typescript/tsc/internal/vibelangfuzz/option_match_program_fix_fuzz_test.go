package vibelangfuzz

import (
	"fmt"
)

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
	legacyType := len(data) > 14 && pick(14)&1 != 0
	optionType := option + ".Option<number>"
	if legacyType {
		option, imports, optionType = "Option", "", "Option<number>"
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
function subject(): %s { events.push("subject"); return %s; }
function handlers() { events.push("handlers"); return %s; }
%s
export effect function main() {
 %s
 return [a, b, events.join(",")];
}
`, imports, optionType, value, handlers, choose, run)
	if legacyType {
		source += "// Option migration witness: keep this trailing note.\n"
	}
	return Archive(map[string]string{"main.vibe": source})
}

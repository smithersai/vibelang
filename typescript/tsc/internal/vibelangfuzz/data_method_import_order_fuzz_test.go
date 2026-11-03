package vibelangfuzz

import (
	"fmt"
	"strings"
)

const dataMethodImportOrderKey = "key:legacy-data-import-order\n"

// Chapter 7's meaning/evaluation-order promise includes module startup.
// The source layout determines whether removing the legacy prepend can
// cross user initialization; aliases, live/type-only uses and values vary.
// FuzzFix's existing contract and Exit checks still verify accepted rewrites.
func dataMethodImportOrderArchive(input string) (string, bool) {
	data := []byte(strings.TrimPrefix(input, dataMethodImportOrderKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	alias := "O"
	if pick(1)&1 != 0 {
		alias = "Opt"
	}
	observer := `import { events } from "./observer.js";`
	namespace := fmt.Sprintf(`import * as %s from "effect/Option";`, alias)
	stop := `import "./stop.js";`
	var imports string
	safe := false
	switch pick(0) % 4 {
	case 0:
		imports = namespace + observer + stop
		safe = true
	case 1:
		imports = observer + namespace + stop
	case 2:
		imports = observer + stop + namespace
	case 3:
		imports = `import "effect/Option";` + observer + namespace + stop
		safe = true
	}
	receiver := "value"
	if pick(2)&1 != 0 {
		receiver = fmt.Sprintf("%s.some(%d)", alias, int(pick(3))-128)
	}
	subject := fmt.Sprintf(`%s
const Option = 42;
export function update(value: %s.Option<number>) { return %s.map((n) => n + %d); }
export const observed = events.slice();
`, imports, alias, receiver, int(pick(4))-128)
	main := fmt.Sprintf(`import { update, observed } from "./subject.js";
export effect function main() {
 return [Option.getOrElse(update(Option.some(%d)), () => -1), observed];
}
`, int(pick(3))-128)
	return Archive(map[string]string{
		"main.vibe":    main,
		"subject.vibe": subject,
		"observer.ts":  `export const events: string[] = []; const previous = Symbol.for; Symbol.for = (key: string) => { events.push(key); return previous(key); }; export function stop() { Symbol.for = previous; }`,
		"stop.ts":      `import { stop } from "./observer.js"; stop();`,
	}), safe
}

package vibelangfuzz

import (
	"maps"
	"slices"
	"strings"
)

// FuzzVIPLegacyServiceReceivers checks --fix-vip-only on pre-VIP-1 functions
// that read a service by calling it, const fs = FileSystem.FileSystem(), and
// call its methods where the old compiler ran them: a statement, an
// initializer, an argument, a catch's head and a conditional arm. After VIP-1
// that read is TS2349, so the checker types fs as an error; the migration
// must still see that each method call ran (decided detail 274: "A legacy
// migration preserves the old call's result/run phase"). The oracle: no
// refusal, and the migrated program compiles, which an Effect left unrun in
// any of these positions does not (foldkit devtools-mcp relayRegistry.vibe
// readRecordFile and readLiveRecordFile).
//
// An input is "<owner>:<position>"; other bytes pick by index.
// Chapter 007 / legacy active outer arrows keep effect kind and direct catch execution: docs/design/src/007-tooling.md#a2e4f6e04325faa7

// legacyReceiverOwners hold BODY with return type RET: an annotated arrow, a
// declaration and an object method, each written as an Effect function whose
// errors are inferred (the methods can fail with PlatformError).
var legacyReceiverOwners = map[string]string{
	"parenthesized-arrow": "export const g = ((path: string): RET!infer E!FileSystem.FileSystem => {\nBODY\n})\n",
	"named-expression":    "export const g = function read(path: string): RET!infer E!FileSystem.FileSystem {\nBODY\n}\n",
	"class-method":        "export class Api { g(path: string): RET!infer E!FileSystem.FileSystem {\nBODY\n} }\n",

	"annotated-arrow": "export const g = (path: string): RET!infer E!FileSystem.FileSystem => {\nBODY\n}\n",
	"declaration":     "export function g(path: string): RET!infer E!FileSystem.FileSystem {\nBODY\n}\n",
	"field-arrow":     "export const api = {\n  g: (path: string): RET!infer E!FileSystem.FileSystem => {\nBODY\n  },\n}\n",
}

// legacyReceiverPositions are a body that reads fs and calls one of its
// methods where the old compiler ran the call, and the body's return type.
var legacyReceiverPositions = map[string]struct{ ret, body string }{
	"statement":   {"number", "  const fs = FileSystem.FileSystem()\n  fs.remove(path)\n  return 0"},
	"initializer": {"number", "  const fs = FileSystem.FileSystem()\n  const text = fs.readFileString(path)\n  return text.length"},
	"argument":    {"number", "  const fs = FileSystem.FileSystem()\n  return legacyLength(fs.readFileString(path))"},
	"catch-head":  {"Option.Option<string>", "  const fs = FileSystem.FileSystem()\n  return legacyDecode(fs.readFileString(path)) catch () => Option.none<string>()"},
	"conditional": {"number", "  const fs = FileSystem.FileSystem()\n  return path.length > 0 ? legacyLength(fs.readFileString(path)) : 0"},
	// The same runs on the read itself, with no const between (Smithers
	// flows/crypto Uuid.vibe: const digest = (Hasher()).digest(input)).
	"member-statement":   {"number", "  FileSystem.FileSystem().remove(path)\n  return 0"},
	"member-initializer": {"number", "  const text = (FileSystem.FileSystem()).readFileString(path)\n  return text.length"},
	"member-argument":    {"number", "  return legacyLength(FileSystem.FileSystem().readFileString(path))"},
	"member-catch-head":  {"Option.Option<string>", "  return legacyDecode((FileSystem.FileSystem()).readFileString(path)) catch () => Option.none<string>()"},
	"member-conditional": {"number", "  return path.length > 0 ? legacyLength(FileSystem.FileSystem().readFileString(path)) : 0"},
}

const legacyReceiverHelpers = `import { FileSystem } from "effect"

const legacyDecode = Schema.decodeUnknownOption(Schema.String)

function legacyLength(text: string): number {
  return text.length
}

`

func legacyReceiverInput(data []byte) (key, source string) {
	owners := slices.Sorted(maps.Keys(legacyReceiverOwners))
	positions := slices.Sorted(maps.Keys(legacyReceiverPositions))
	owner, position, _ := strings.Cut(string(data), ":")
	if legacyReceiverOwners[owner] == "" || legacyReceiverPositions[position].body == "" {
		if len(data) < 2 {
			return "", ""
		}
		owner, position = owners[int(data[0])%len(owners)], positions[int(data[1])%len(positions)]
	}
	p := legacyReceiverPositions[position]
	body := p.body
	if owner == "field-arrow" {
		body = "  " + strings.ReplaceAll(body, "\n", "\n  ")
	}
	text := strings.ReplaceAll(strings.ReplaceAll(legacyReceiverOwners[owner], "RET", p.ret), "BODY", body)
	return owner + ":" + position, legacyReceiverHelpers + text
}

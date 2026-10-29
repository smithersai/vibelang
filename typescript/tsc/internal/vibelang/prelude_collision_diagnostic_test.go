package vibelang

import (
	"strings"
	"testing"
)

// Each error on a name the prelude settles names the meaning the name got
// and the way to the other one; a name the file declares or imports, and a
// member no meaning has, get no note.
func TestPreludeCollisionNotes(t *testing.T) {
	for _, test := range []struct {
		name, source string
		code         int32
		want         string
	}{
		{"namespace as a type", "export function send(m: Message) { return m }", 2709,
			"Message is Effect's Message module (effect/cluster/Message), in scope without an import. To use your own Message, declare or import it."},
		{"generic type", "export function run(c: Command) { return c }", 2707,
			"Command is Effect's Command module (effect/cli/Command), in scope without an import."},
		{"DOM constructor", `export function start() { return new Worker("./worker.js") }`, 2351,
			"For the DOM's Worker, write globalThis.Worker inside a hatch or a module block."},
		{"DOM type", "export function size(c: Cache) { return c }", 2707,
			"For the DOM's Cache type, alias it in a .ts file, as in export type DomCache = Cache, and import the alias."},
		{"DOM type member", `export function post(w: Worker<string, string>) { return w.postMessage("x") }`, 2339,
			"The DOM's Worker has postMessage; to use it, alias the DOM's type in a .ts file, as in export type DomWorker = Worker, and import the alias."},
		{"JavaScript global", "export function add() { return Number.sum(1, 2) }", 2339,
			`Number is JavaScript's Number here, which wins over Effect's Number module (effect/Number). To call Effect's Number.sum, import the module under another name: import { Number as EffectNumber } from "effect".`},
		{"JavaScript Array", "export function one() { return Array.make(1) }", 2339,
			`import { Array as EffectArray } from "effect"`},
		{"web global", "export function headers() { return Headers.fromInput({}) }", 2339,
			`Headers is the web's Headers here, which wins over Effect's Headers module (effect/http/Headers). To call Effect's Headers.fromInput, import the module under another name: import { Headers as EffectHeaders } from "effect/http".`},
		{"own namespace", "namespace Message { export const text = 1 }\nexport function send(m: Message) { return m }", 2709, ""},
		{"own Number", "const Number = { one: 1 }\nexport function add() { return Number.sum(1, 2) }", 2339, ""},
		{"no meaning has it", "export function add() { return Number.notAMember(1) }", 2339, ""},
		{"runtime prelude", "export function build(l: Layer) { return l }", 2707, ""},
		{"DOM type member on a service", "export function root(fs: FileSystem) { return fs.root }", 2339,
			"FileSystem is Effect's FileSystem type (effect/FileSystem): in a .vibe file the bare type name FileSystem means Effect's. The DOM's FileSystem has root"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			var found []string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == test.code {
					found = append(found, diagnosticWithNotes(d))
				}
			}
			if len(found) != 1 {
				t.Fatalf("got %d TS%d diagnostics, want 1: %q", len(found), test.code, found)
			}
			if test.want == "" {
				for _, phrase := range []string{"in scope without an import", "wins over Effect's", "The DOM's", "For the DOM's"} {
					if strings.Contains(found[0], phrase) {
						t.Fatalf("got a note on a name the prelude does not settle:\n%s", found[0])
					}
				}
			} else if !strings.Contains(found[0], test.want) {
				t.Fatalf("diagnostic lacks %q:\n%s", test.want, found[0])
			}
		})
	}
}

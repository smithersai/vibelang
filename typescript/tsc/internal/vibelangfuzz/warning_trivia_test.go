package vibelangfuzz

import (
	"fmt"
	"maps"
	"strconv"
	"strings"
	"testing"
)

// A diagnostic directive starts its comment line. Trivia on earlier lines or
// after the directive preserves it; an inline block before it does not.
func TestWarningTriviaKeepsAdvisories(t *testing.T) {
	w := NewWorkspace(t)
	generators := map[int32][]Seed{}
	generators[4817] = []Seed{{Name: "EK4817-observer", Files: map[string]string{"main.vibe": "// @vibelang-diagnostics EK4817:warning\nimport {readValue, readType,traceOf} from \"./host.js\"\nexport {traceOf}\nclass Person extends Schema.Class<Person>(\"Person\")({name:Schema.String}) {}\nexport effect function main() { return (try readValue(Person)) instanceof (try readType(Person)) }\n", "host.ts": "import {Effect} from \"effect\"\nconst trace:string[]=[];export const traceOf=()=>trace;export function readValue(ctor:{prototype:object}){return Effect.sync(()=>{trace.push(\"left\");return Object.create(ctor.prototype)})}\nexport function readType<S>(ctor:S){return Effect.sync(()=>{trace.push(\"right\");return ctor})}\n"}}}
	generators[4821] = []Seed{{Name: "EK4821-observer", Files: map[string]string{"main.vibe": "// @vibelang-diagnostics EK4821:warning\nimport { javascriptMake } from \"./host.js\"\nexport const Opened = Schema.Struct({_tag: Schema.Literal(\"Opened\"), at: Schema.Number})\nexport effect function main() { return try javascriptMake(Opened) }\n", "host.ts": "import { Effect } from \"effect\"\nexport function javascriptMake(codec: unknown) { return Effect.sync(() => { try { return {returned: (codec as {make(v:unknown):unknown}).make({at:7})} } catch (e) { return {thrown: {name: (e as Error).name, message: (e as Error).message}} } }) }\n"}}}
	for _, code := range []int32{4817, 4821} {
		for _, n := range []int{0, 1, 3, 5} {
			t.Run(fmt.Sprintf("EK%d/%d", code, n), func(t *testing.T) {

				files := maps.Clone(generators[code][0].Files)
				main := toolsMainFile(files)
				sentinel := "// diagnostic trivia " + strconv.Itoa(n) + "\n"
				if n&1 != 0 {
					sentinel = "/* diagnostic trivia " + strconv.Itoa(n) + " 🧪 */ "
				}
				at := 0
				for _, line := range strings.SplitAfter(files[main], "\n") {
					trimmed := strings.TrimSpace(line)
					if trimmed != "" && !strings.HasPrefix(trimmed, "//") {
						break
					}
					at += len(line)
				}
				if n == 1 || n == 5 {
					at = 0
				}
				if n == 5 {
					sentinel += "\n"
				}
				files[main] = files[main][:at] + sentinel + files[main][at:]
				if n&1 != 0 {
					files[main] += "\n/** diagnostic trivia tail 🧪 */\n"
				}
				if n&2 != 0 {
					for name, text := range files {
						if isSource(name) {
							files[name] = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n")
						}
					}
				}
				r, err := w.Compile(t.Context(), Project{Files: files})
				if err != nil {
					t.Fatal(err)
				}

				defer r.Remove()
				if !toolsErrorFree(r) {
					t.Fatalf("warning fixture is not admitted: %v", SortedKeys(Keys(r.Dir, r.Diagnostics)))
				}
				found := false
				for _, d := range r.Diagnostics {
					found = found || IsEK(d) && d.Code() == code
				}
				if want := n != 1; found != want {
					t.Fatalf("EK%d present=%t, want %t: %s", code, found, want, Archive(files))
				}
			})
		}
	}
}

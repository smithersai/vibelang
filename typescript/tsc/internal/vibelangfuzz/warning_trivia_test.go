package vibelangfuzz

import (
	"fmt"
	"maps"
	"strconv"
	"strings"
	"testing"
)

// A trivia mutation must keep off-by-default diagnostics enabled. Putting an
// inline block comment before a file directive silently disabled these sites.
func TestWarningTriviaKeepsAdvisories(t *testing.T) {
	w := NewWorkspace(t)
	generators := map[int32][]Seed{}
	generators[4817] = []Seed{{Name: "EK4817-observer", Files: map[string]string{"main.vibe": "// @vibelang-diagnostics EK4817:warning\nimport {readValue, readType,traceOf} from \"./host.js\"\nexport {traceOf}\nclass Person extends Schema.Class<Person>(\"Person\")({name:Schema.String}) {}\nexport effect function main() { return (try readValue(Person)) instanceof (try readType(Person)) }\n", "host.ts": "import {Effect} from \"effect\"\nconst trace:string[]=[];export const traceOf=()=>trace;export function readValue(ctor:{prototype:object}){return Effect.sync(()=>{trace.push(\"left\");return Object.create(ctor.prototype)})}\nexport function readType<S>(ctor:S){return Effect.sync(()=>{trace.push(\"right\");return ctor})}\n"}}}
	generators[4821] = []Seed{{Name: "EK4821-observer", Files: map[string]string{"main.vibe": "// @vibelang-diagnostics EK4821:warning\nimport { javascriptMake } from \"./host.js\"\nexport const Opened = Schema.Struct({_tag: Schema.Literal(\"Opened\"), at: Schema.Number})\nexport effect function main() { return try javascriptMake(Opened) }\n", "host.ts": "import { Effect } from \"effect\"\nexport function javascriptMake(codec: unknown) { return Effect.sync(() => { try { return {returned: (codec as {make(v:unknown):unknown}).make({at:7})} } catch (e) { return {thrown: {name: (e as Error).name, message: (e as Error).message}} } }) }\n"}}}
	for _, code := range []int32{4817, 4821} {
		for _, choices := range [][]byte{{0}, {3, 1}} {
			t.Run(fmt.Sprintf("EK%d/%v", code, choices), func(t *testing.T) {

				files := maps.Clone(generators[code][0].Files)
				main := toolsMainFile(files)
				n := int(choices[0])
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
				for _, d := range r.Diagnostics {
					if IsEK(d) && d.Code() == code {
						return
					}
				}
				t.Fatalf("trivia removed EK%d: %s", code, Archive(files))
			})
		}
	}
}

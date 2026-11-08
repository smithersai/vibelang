package vibelangfuzz

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const relicRejectionTarget = "FuzzRelicControlRejection"
const relicRetirementQuote = "No accepted VIP adds `control`, `handle`, `resume` or `abandon`, so they and the continuation runtime are removed from the compiler."

func TestRelicControlRejectionQuoted(t *testing.T) { relicRejectionQuoted(t) }
func relicRejectionQuoted(t testing.TB) {
	chapter, err := os.ReadFile(SpecPath("../vips/0035-handlers-open.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), relicRetirementQuote) {
		t.Fatalf("stale first-release retirement oracle: %q", relicRetirementQuote)
	}
	relicMigrationQuoted(t)
}
func FuzzRelicControlRejection(f *testing.F) {
	startShortBudget(f)
	relicRejectionQuoted(f)
	keys := []string{"control", "handle", "resume", "abandon", "select", "alias", "native-control", "native-handle", "native-resume", "native-abandon", "native-select", "callback-resume", "native-Control-class", "resumeWith", "native-resumeWith", "computed", "native-computed", "runtime-key", "native-key", "control-nocheck", "select-nocheck", "runtime-shorthand", "native-shorthand", "runtime-reexport", "runtime-star-export", "runtime-destructure", "native-destructure", "native-reexport", "native-runtime-namespace", "runtime-Control", "runtime-computed-destructure", "native-computed-destructure", "native-service-Control", "runtime-union-key", "runtime-union-destructure", "native-union-key", "native-union-destructure", "legacy-control-class", "legacy-handle", "control-fork", "legacy-resumeWith-contract"}
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := string(data)
		known := false
		for _, k := range keys {
			if k == key {
				known = true
			}
		}
		if !known {
			if len(data) == 0 {
				return
			}
			key = keys[int(data[0])%len(keys)]
		}
		source := ""
		want := int32(3501)
		switch key {
		case "legacy-resumeWith-contract":
			data, err := os.ReadFile("testdata/fuzz/FuzzCompile/appendix-ek9210-complete-project")
			if err != nil {
				t.Fatal(err)
			}
			line := strings.Split(string(data), "\n")[1]
			text, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(line, "string("), ")"))
			if err != nil {
				t.Fatal(err)
			}
			source = Unarchive(text)["main.vibe"]
		case "legacy-control-class":
			source = `abstract class Ask extends Control { abstract ask(x: number): number!! }; export const old = Ask`
		case "legacy-handle":
			source = `export const old = handle`
		case "control-fork":
			source = `control Ask { ask(x: number): number!! }; export effect function probe() { const child = fork Ask.ask(1); return join child }`
		case "native-reexport":
			source = `export {identity as resume} from "effect/Function"`
			want = 0
		case "runtime-reexport":
			source = `export {resume as old} from "vibelang-runtime"`
		case "runtime-star-export":
			source = `export * from "vibelang-runtime"`
		case "runtime-union-key":
			source = `import * as Old from "vibelang-runtime"; const key=Math.random()>0.5?"resume":"abandon"; export const old=Old[key]`
		case "runtime-union-destructure":
			source = `import * as Old from "vibelang-runtime"; const key=Math.random()>0.5?"resume":"abandon"; const {[key]:r}=Old; export const old=r`
		case "native-union-key":
			source = `const object={resume(n: number){return n},abandon(n: number){return n}}; const key=Math.random()>0.5?"resume":"abandon"; export const value=object[key](1)`
			want = 0
		case "native-union-destructure":
			source = `const object={resume(n: number){return n},abandon(n: number){return n}}; const key=Math.random()>0.5?"resume":"abandon"; const {[key]:r}=object; export const value=r(1)`
			want = 0
		case "runtime-computed-destructure":
			source = `import * as Old from "vibelang-runtime"; const key="resume" as const; const {[key]:r}=Old; export const old=r`
		case "native-computed-destructure":
			source = `const object={resume(n: number){return n}}; const key="resume" as const; const {[key]:r}=object; export const value=r(1)`
			want = 0
		case "runtime-destructure":
			source = `import * as Old from "vibelang-runtime"; const {resume: r} = Old; export const old=r`
		case "native-destructure":
			source = `const object={resume(n: number){return n}}; const {resume:r}=object; export const value=r(1)`
			want = 0
		case "control":
			source = "control Ask { ask(x: number): number!! }"
		case "handle":
			source = "control Ask { ask(x: number): number!! }; export effect function probe() { try { return try Ask.ask(1) } handle Ask.ask(x) { return try resume(x) } }"
		case "control-nocheck":
			source = "// @ts-nocheck\ncontrol Ask {ask(): number!!}"
		case "select-nocheck":
			source = "// @ts-nocheck\nexport effect function probe(){select {default: return 1}}"
			want = 4607

		case "runtime-shorthand":
			source = "export const object={resume}"
		case "native-shorthand":
			source = "export function probe(resume: (n: number) => number){return {resume}}"
			want = 0

		case "native-service-Control":
			source = `service Control {static readonly key = "native/control"; readonly value: number}
export effect function probe() {provide Control = {value:7} {return (try Control).value}}`
			want = 0
		case "native-runtime-namespace":
			source = `import {Control} from "vibelang-runtime"; export const value=Control.value`
			want = 0
		case "runtime-key":
			source = `import * as Old from "vibelang-runtime"; const key="resume" as const; export const legacy=Old[key]`
		case "native-key":
			source = `const object={resume(n: number){return n}}; const key="resume" as const; export const value=object[key](1)`
			want = 0
		case "computed":
			source = `import * as Old from "vibelang-runtime"; export const legacy=Old["resume"]`
		case "native-computed":
			source = `const object = {resume(n: number){return n}}; export const value=object["resume"](1)`
			want = 0
		case "runtime-Control":
			source = `import {Control as Key} from "vibelang-runtime"; export const old=Key`
		case "resumeWith":
			source = "export const relic = resumeWith"
		case "native-Control-class":
			source = "abstract class Control {abstract value(): number}; export abstract class Native extends Control {abstract value(): number}"
			want = 0
		case "resume":
			source = "export const relic = resume"
		case "abandon":
			source = "export const relic = abandon"
		case "select":
			source = "export effect function probe() { select { case value = Effect.succeed(1): return value } }"
			want = 4607
		case "alias":
			source = "import { resume as k } from 'vibelang-runtime'; export const relic = k"
		case "callback-resume":
			source = "export const program = Effect.callback<number>(resume => resume(Effect.succeed(1)))"
			want = 0
		default:
			name := strings.TrimPrefix(key, "native-")
			source = fmt.Sprintf("export function probe(%s: (n: number) => number) { return %s(1) }; export const object = { %s(n: number) {return n} }", name, name, name)
			want = 0
		}
		// Vary symbol names and source locations, not only which witness is
		// selected. The oracle must follow resolved export identity through
		// fresh namespace aliases and computed destructuring keys.
		variant := uint32(2166136261)
		for _, b := range data {
			variant = (variant ^ uint32(b)) * 16777619
		}
		source = strings.ReplaceAll(source, "Old", fmt.Sprintf("Runtime%d", variant))
		source = strings.ReplaceAll(source, "const key=", fmt.Sprintf("const member%d=", variant))
		source = strings.ReplaceAll(source, "[key]", fmt.Sprintf("[member%d]", variant))
		source = strings.ReplaceAll(source, "Ask", fmt.Sprintf("Ask%d", variant))
		prefix := fmt.Sprintf("/* generated alias %d */", variant)
		// ts-nocheck is only effective before the first statement; comments
		// and blank lines must keep its retirement grammar rejection.
		source = prefix + strings.Repeat("\n", 1+len(data)%4) + source
		project := Project{Files: map[string]string{"main.vibe": source}}
		if key == "native-runtime-namespace" {
			project = relicNativeNamespaceProject(source)
		}
		result, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		found := false
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 9210 {
				t.Fatal("retired operation-contract identity emitted after continuation retirement")
			}
			if d.Source() == "EK" && d.Code() == want && d.Category() == diagnostics.CategoryError {
				if !strings.Contains(d.String(), "outside the first release") {
					Gap(t, relicRejectionTarget, "diagnostic:"+key, "retirement diagnostic does not describe the retired form: %v", d)
				}
				found = true
			}
			if want == 0 && d.Category() == diagnostics.CategoryError {
				Gap(t, relicRejectionTarget, "native:"+key, "ordinary binding rejected: %v", Keys(result.Dir, result.Diagnostics))
				return
			}
		}
		if want != 0 && !found {
			Gap(t, relicRejectionTarget, "reject:"+key, "missing EK%04d for retired form: %v", want, Keys(result.Dir, result.Diagnostics))
		}
	})
}

package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const legacyEffectGlobalFixQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func legacyEffectGlobalFixCited(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("../vips/0006-effect-globals.md"), effectGlobalsQuote) {
		t.Fatal("VIP-6 global rule changed")
	}
	if !strings.Contains(SpecText("007-tooling.md"), legacyEffectGlobalFixQuote) {
		t.Fatal("migration preservation rule changed")
	}
}

func TestLegacyEffectGlobalFixQuoted(t *testing.T) { legacyEffectGlobalFixCited(t) }

var legacyEffectGlobalFixKeys = []string{"scope-first", "typed", "receiver", "nested", "fresh", "native-order", "shadow", "comments-refuse", "foldkit-by-name", "foldkit-by-name-untried"}

func FuzzLegacyEffectGlobalFix(f *testing.F) {
	startShortBudget(f)
	legacyEffectGlobalFixCited(f)
	for _, key := range legacyEffectGlobalFixKeys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Cleanup(node.Close)
	f.Fuzz(func(t *testing.T, data []byte) {
		index, n, mode := 0, 7, 0
		if len(data) > 0 {
			index = int(data[0]) % len(legacyEffectGlobalFixKeys)
		}
		if len(data) > 1 {
			n = int(int8(data[1]))
			mode = int(data[1]) % 2
		}
		for i, key := range legacyEffectGlobalFixKeys {
			if string(data) == key {
				index = i
			}
		}
		key := legacyEffectGlobalFixKeys[index]
		trace := `import {Effect,Scope} from "effect"
export const events:string[]=[]
/** @throws {never} */
export function markScope(s:Scope.Closeable){events.push("scope");return s}
/** @throws {never} */
export function markProgram<A,E,R>(p:Effect.Effect<A,E,R>){events.push("program");return p}
/** @throws {never} */
export function ev(){events.push("run")}
export const receiver={
/** @throws {never} */
scope(s:Scope.Closeable){events.push("scope:"+String(this===receiver));return s},
/** @throws {never} */
program<A,E,R>(p:Effect.Effect<A,E,R>){events.push("program:"+String(this===receiver));return p}}
`
		head := "import {events,markScope,markProgram,receiver,ev} from \"./trace.js\"\n"
		prefix := ""
		callee, referenceCall := "forkIn", "legacyForkIn"
		first, second := "markScope(scope)", "markProgram(program)"
		types := ""
		join := "const value=try Fiber.join(fiber);"
		if key == "typed" {
			types = "<number,never,never>"
		}
		if key == "receiver" {
			first, second = "receiver.scope(scope)", "receiver.program(program)"
		}
		if key == "fresh" {
			prefix = "const $legacyForkEffect=1,$legacyForkScope=2,$legacyForkProgram=3;\n"
		}
		if key == "native-order" {
			first, second = "markProgram(program)", "markScope(scope)"
			referenceCall = "Effect.forkIn"
		}
		if key == "shadow" {
			prefix = "const forkIn=(s:Scope.Scope,p:Effect.Effect<number>)=>Effect.forkIn(p,s);\n"
			referenceCall = "forkIn"
		}
		sourceWork, referenceWork := "", ""
		sourceSecond, referenceSecond := second, second
		if strings.HasPrefix(key, "foldkit-by-name") {
			sourceWork = fmt.Sprintf("effect function work(){ev();return %d}\n", n)
			referenceWork = fmt.Sprintf("function work(){return Effect.sync(()=>{ev();return %d})}\n", n)
			sourceSecond = "() => work()"
			referenceSecond = "Effect.suspend(()=>work())"
		}
		if key == "nested" {
			sourceSecond = "forkIn(markScope(scope),markProgram(program))"
			referenceSecond = "legacyForkIn(markScope(scope),markProgram(program))"
			join = "const inside=try Fiber.join(fiber);const value=try Fiber.join(inside);"
		}
		if key == "comments-refuse" {
			first = "/* keep scope */" + first
		}
		body := fmt.Sprintf("const scope=try Scope.make();const program=Effect.sync(()=>{ev();return %d});const fiber=try %s%s(%s,%s);%stry Scope.close(scope,Exit.succeed(undefined));return {value,events:events.slice()}", n, callee, types, first, sourceSecond, join)
		referenceBody := fmt.Sprintf("const scope=try Scope.make();const program=Effect.sync(()=>{ev();return %d});const fiber=try %s%s(%s,%s);%stry Scope.close(scope,Exit.succeed(undefined));return {value,events:events.slice()}", n, referenceCall, types, first, referenceSecond, join)
		if strings.HasPrefix(key, "foldkit-by-name") {
			// The legacy fixture holds only the by-name work. An unused
			// current-source Effect.sync initializer would have run before
			// VIP-1, and therefore belongs in neither side of this oracle.
			unused := fmt.Sprintf("const program=Effect.sync(()=>{ev();return %d});", n)
			body = strings.Replace(body, unused, "", 1)
			referenceBody = strings.Replace(referenceBody, unused, "", 1)
		}
		if key == "foldkit-by-name-untried" {
			body = strings.Replace(body, "const fiber=try ", "const fiber=", 1)
		}
		source := head + prefix + sourceWork + "export effect function verify(){" + body + "}\n"
		reference := "import {Effect,Scope,Fiber,Exit} from \"effect\"\nimport {forkIn as legacyForkIn} from \"vibelang-runtime\"\n" + head + prefix + referenceWork + "export function verify(){return Effect.gen(function*(){" + strings.ReplaceAll(referenceBody, "try ", "yield* ") + "})}\n"
		before, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "trace.ts": trace}})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		wantError := key != "native-order" && key != "shadow"
		hasOrderError := !toolsErrorFree(before)
		if hasOrderError != wantError {
			t.Fatalf("invalid %s generator: %v", key, SortedKeys(Keys(before.Dir, before.Diagnostics)))
		}
		options := []vibelang.FixOptions{{}, {MigrationOnly: true}}[mode]
		if strings.HasPrefix(key, "foldkit-by-name") {
			options = vibelang.FixOptions{VIPOnly: true}
		}
		fix := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
		if fix.Err != nil || len(fix.Refused) > 0 {
			t.Fatalf("fix: %v %+v", fix.Err, fix.Refused)
		}
		if key == "comments-refuse" {
			if len(fix.Files) > 0 {
				Gap(t, "FuzzLegacyEffectGlobalFix", key, "comment-bearing input was partially changed")
			}
			return
		}
		text := source
		for name, file := range fix.Files {
			if strings.HasSuffix(name.AsString(), "/main.vibe") {
				text = file.Text
			}
		}
		fixed, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": text, "trace.ts": trace}})
		if err != nil {
			t.Fatal(err)
		}
		defer fixed.Remove()
		if !toolsErrorFree(fixed) {
			Gap(t, "FuzzLegacyEffectGlobalFix", key, "repaired source diagnostics: %v\n%s", SortedKeys(Keys(fixed.Dir, fixed.Diagnostics)), text)
			return
		}
		expected, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": reference, "trace.ts": trace}})
		if err != nil {
			t.Fatal(err)
		}
		defer expected.Remove()
		if !toolsErrorFree(expected) {
			t.Fatalf("invalid reference: %v", SortedKeys(Keys(expected.Dir, expected.Diagnostics)))
		}
		was, is := node.Run(expected, "out/main.js", "verify"), node.Run(fixed, "out/main.js", "verify")
		if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || !toolsSameOutcome(was, is) {
			Gap(t, "FuzzLegacyEffectGlobalFix", key, "evaluation changed: %+v -> %+v", was, is)
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, fixed.Dir), options)
		if again.Err != nil || len(again.Files) > 0 {
			Gap(t, "FuzzLegacyEffectGlobalFix", key, "not idempotent: %v %v", again.Err, again.Order)
		}
		ExpectPending(t, "FuzzLegacyEffectGlobalFix", key)
	})
}

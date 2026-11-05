package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const staticDefaultEagerQuote = "The initializer runs once, eagerly at the declaration's existing execution point, in source order"

func staticDefaultChapter(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), "A rewrite that can't preserve types, behavior and declaration output refuses at that site.") {
		t.Fatal("chapter 007 migration preservation rule changed")
	}
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), staticDefaultEagerQuote) {
		t.Fatalf("missing quote %q", staticDefaultEagerQuote)
	}
}
func TestStaticDefaultFixQuoted(t *testing.T) { staticDefaultChapter(t) }

// Chapters 005 and 007 require eager initialization and API identity. Observe
// cached object identity, initialization events, native key metadata and a
// missing-provider lookup: opting into Reference fallback changes that Exit.
// Keep every runtime seed fast; the independent stock-TypeScript API gate
// runs on representative declaration shapes in a dedicated regression.
func FuzzStaticDefaultFix(f *testing.F) {
	startShortBudget(f)
	staticDefaultChapter(f)
	for _, key := range staticDefaultFixKeys {
		f.Add([]byte(key))
	}
	f.Add([]byte{12, 1})
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Cleanup(node.Close)
	f.Fuzz(func(t *testing.T, data []byte) {
		checkStaticDefaultFix(t, w, node, data, false)
	})
}

func TestStaticDefaultFixDeclarationIdentity(t *testing.T) {
	staticDefaultChapter(t)
	w := NewWorkspace(t)
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(node.Close)
	for _, key := range []string{"typed-object", "untyped-object", "mutable-shape", "reference-stays", "type-reads", "type-reads-inferred"} {
		t.Run(key, func(t *testing.T) {
			checkStaticDefaultFix(t, w, node, []byte(key), true)
		})
	}
}

var staticDefaultFixKeys = []string{"typed-object", "untyped-object", "literal-data", "readonly", "recursive", "nested", "shadow", "exported-stays", "comment-stays", "reference-stays", "native-stays", "plain-join-init", "mutable-shape", "type-reads", "type-reads-inferred"}

func checkStaticDefaultFix(t *testing.T, w *Workspace, node *Node, data []byte, compareAPI bool) {
	t.Helper()
	keys := staticDefaultFixKeys
	trace := "import {Effect} from \"effect\"\nexport const events:string[]=[\"trace:\"+typeof (Symbol as any).customMatcher]\n/** @throws {never} */\nexport function make(n:number){events.push(\"make\");return {n}}\n/** @throws {never} */\nexport function missing(key:any):string{const exit=Effect.runSyncExit(Effect.gen(function*(){return yield* key}) as Effect.Effect<unknown>);return exit._tag}\n/** @throws {never} */\nexport function describe(key:any){return {name:key.name,key:key.key,own:Object.keys(key).sort()}}\n"

	i, n, mode := 0, 7, 0
	if len(data) > 0 {
		i = int(data[0]) % len(keys)
	}
	if len(data) > 1 {
		n = int(int8(data[1]))
		mode = int(data[1]) % 2
	}
	for j, key := range keys {
		if string(data) == key {
			i = j
		}
	}
	key := keys[i]
	want := true
	head := "import {events,make,missing,describe} from \"./trace.js\"\n"
	init := fmt.Sprintf("make(%d)", n)
	annotation := ": Flags.Shape"
	members := "n:number"
	prefix := ""
	extra := ""
	switch key {
	case "type-reads", "type-reads-inferred":
		members = "enabled:boolean;count:number"
		init = fmt.Sprintf("({enabled:true,count:%d})", n)
		if key == "type-reads-inferred" {
			annotation = ""
		}
		// Tuple display strings retain private helper names. The TypeScript
		// API-identity checker compares their exported structural contract.
		compareAPI = true
	case "mutable-shape":
		init = "({n:7,nested:{count:1}})"
		members = "n:number;readonly fixed?:true;nested:{count:number}"
	case "plain-join-init":
		annotation = ""
		head += "import {make as join} from \"./trace.js\"\n"
		init = fmt.Sprintf("join(%d)", n)
	case "untyped-object":
		annotation = ""
	case "literal-data":
		annotation = ""
		init = fmt.Sprintf("%d", n)
	case "readonly":
		annotation = ""
		init = fmt.Sprintf("({n:%d} as const)", n)
	case "recursive":
		members += ";next?:Flags.Shape"
	case "shadow":
		head += "const \\u0024legacyServiceContext=1;type $legacyServiceShape={bad:string};const $legacyServiceInit=2\n"
	case "exported-stays":
		prefix = "export "
		want = false
	case "comment-stays":
		extra = "/** retain cached data documentation */"
		want = false
	case "reference-stays":
		extra = "static readonly defaultValue=()=>({n:9});"
		want = false
	case "native-stays":
		want = false
	}
	declaration := prefix + "service Flags {static readonly key=\"native-default/Flags\";" + extra + "static readonly default" + annotation + "=" + init + ";" + members + "}\n"
	if key == "native-stays" {
		declaration = "class Flags extends Object {static readonly default=" + init + "}\n"
		annotation = ""
	}
	body := "const first=Flags.default;const second=Flags.default;return {same:first===second,first,events:events.slice(),missing:missing(Flags),key:describe(Flags)}"
	source := head + declaration + "export type Value=typeof Flags.default\nexport effect function verify(){" + body + "}\n"
	if key == "nested" || key == "plain-join-init" {
		declaration = strings.Replace(declaration, ": Flags.Shape", "", 1)
		source = head + "export effect function verify(){" + declaration + body + "}\n"
	}
	if key == "mutable-shape" {
		source = strings.Replace(source, "const first=Flags.default;", "const first=Flags.default;first.n++;first.nested.count++;", 1)
	}

	if key == "type-reads" || key == "type-reads-inferred" {
		source += "export type Indexed = (typeof Flags)[\"default\"]\nexport type Enabled = (typeof Flags.default)[\"enabled\"]\nexport type Count = typeof Flags.default.count\nexport type Combined = [Value, Indexed, Enabled, Count]\n"
	}
	files := map[string]string{"main.vibe": source, "trace.ts": trace}
	before, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer before.Remove()
	for _, d := range before.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("invalid %s generator: %s", key, d.String())
		}
	}
	was := node.Run(before, "out/main.js", "verify")
	if toolsInvalidOutcome(was) {
		t.Fatalf("original outcome: %+v", was)
	}
	// This compares current source semantics. The separate opt-in legacy
	// readonly upgrade intentionally changes the source baseline.
	opts := []vibelang.FixOptions{{VIPOnly: true}, {}}[mode]
	if compareAPI {
		opts = vibelang.FixOptions{}
	}
	fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), opts)
	if fixed.Err != nil || len(fixed.Refused) > 0 {
		t.Fatalf("%v; %+v", fixed.Err, fixed.Refused)
	}
	text := source
	for name, file := range fixed.Files {
		if strings.HasSuffix(name.AsString(), "/main.vibe") {
			text = file.Text
		}
	}
	if strings.Contains(text, "class Flags extends $legacyServiceContext") != want {
		Gap(t, "FuzzStaticDefaultFix", key, "native=%v: %s", want, text)
		return
	}
	files["main.vibe"] = text
	after, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer after.Remove()
	for _, d := range after.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("fixed %s: %s", key, d.String())
		}
	}
	if compareAPI {
		if diff := compareServiceDefaultDeclarations(t, w, before, after); diff != "" {
			Gap(t, "FuzzStaticDefaultFix", key, "API identity changed: %s", diff)
			return
		}
	}
	is := node.Run(after, "out/main.js", "verify")
	if toolsInvalidOutcome(is) || !toolsSameOutcome(was, is) {
		Gap(t, "FuzzStaticDefaultFix", key, "cached identity, eager work or key behavior changed: %+v -> %+v", was, is)
		return
	}
	again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), opts)
	if again.Err != nil || len(again.Files) > 0 {
		t.Fatalf("not idempotent: %v %d", again.Err, len(again.Files))
	}
	ExpectPending(t, "FuzzStaticDefaultFix", key)
}

// Consumers need the same real dependencies as the source project. Reuse
// the workspace's installed packages without modifying the shared API gate.
func compareServiceDefaultDeclarations(t *testing.T, w *Workspace, before, after *Result) string {
	t.Helper()
	dirs := []string{t.TempDir(), t.TempDir()}
	for i, outputs := range []map[string]string{before.Outputs, after.Outputs} {
		if err := os.WriteFile(filepath.Join(dirs[i], "package.json"), []byte(`{"type":"module"}`), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(w.Dir, "node_modules"), filepath.Join(dirs[i], "node_modules")); err != nil {
			t.Fatal(err)
		}
		count := 0
		for file, text := range outputs {
			if !isDeclaration(file) {
				continue
			}
			if err := writeInside(dirs[i], file, text); err != nil {
				t.Fatal(err)
			}
			count++
		}
		if count == 0 {
			t.Fatal("project emitted no declarations")
		}
	}
	return compareDeclarationTrees(t, dirs[0], dirs[1])
}

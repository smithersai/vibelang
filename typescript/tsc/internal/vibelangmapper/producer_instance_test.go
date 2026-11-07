package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestProducerProjectEffectInstanceRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, test := range []struct{ name, factory, stream, mutate string }{
		{"declaration", "effect function* samples(owner:number) { for(const item of [1,2,3]) yield try owns(owner,item) }", "samples(owner)", ""},
		{"object", "const object={marker:false,effect *samples(owner:number) { for(const item of [1,2,3]) yield (try owns(owner,item))&&this.marker }}", "object.samples(owner)", "object.marker=true;"},
		{"class", "class Feed { marker=false; effect *samples(owner:number) { for(const item of [1,2,3]) yield (try owns(owner,item))&&this.marker }} const feed=new Feed();", "feed.samples(owner)", "feed.marker=true;"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := `import {Effect as Eff,Fiber as Fib,Stream as Str} from "effect"
effect function owns(owner:number,item:number) { const current=try Eff.fiberId; const child=try Eff.forkChild(Eff.succeed(item)); const okay=owner<current&&current<child.id; try Fib.join(child); return okay }
$FACTORY$
export effect function main() { const anchor=try Eff.forkChild(effect { const owner=try Eff.fiberId; const stream=$STREAM$; $MUTATE$ return try Str.runCollect(stream) }); return try Fib.join(anchor) }
`
			source = strings.NewReplacer("$FACTORY$", test.factory, "$STREAM$", test.stream, "$MUTATE$", test.mutate).Replace(source)
			js, _, diagnostics := Emit(source, testContext)
			if len(diagnostics) != 0 {
				t.Fatalf("admission: %v\n%s", diagnostics, js)
			}
			dir := t.TempDir()
			if err := os.Symlink(filepath.Join(scope, "node_modules"), filepath.Join(dir, "node_modules")); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Join(dir, "app"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "app/main.mjs"), []byte(js), 0600); err != nil {
				t.Fatal(err)
			}
			runner := `import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {createRequire} from "node:module"
const require=createRequire(import.meta.url)
const source=path.dirname(path.dirname(require.resolve("effect/Effect")))
fs.mkdirSync(new URL("./app/node_modules/",import.meta.url),{recursive:true})
fs.cpSync(source,new URL("./app/node_modules/effect/",import.meta.url),{recursive:true})
const Effect=await import("./app/node_modules/effect/dist/Effect.js")
const {main}=await import("./app/main.mjs")
const exit=await Effect.runPromiseExit(main())
assert.equal(exit._tag,"Success")
assert.deepEqual(exit.value,[true,true,true])
`
			if err := os.WriteFile(filepath.Join(dir, "run.mjs"), []byte(runner), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "run.mjs")
			cmd.Dir = dir
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("runtime: %v\n%s\n%s", err, output, js)
			}
		})
	}
}

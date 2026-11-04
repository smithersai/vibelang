package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Baseline D552 programs were measured before the repair: the receiver
// lookup precedes arguments; holding a result calls its factory but never
// runs the returned Effect; a tried plain method runs the lookup only.
func TestServiceMemberMigrationRunPhase(t *testing.T) {
	w := NewWorkspace(t)
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(node.Close)
	for _, tc := range []struct{ name, body, want, trace string }{
		{"effect-value-tried", `const value=try Users.read();return [value,calls,ran,args]`, `[7,0,1,0]`, `[0,1,0]`},
		{"effect-value-run", `const value=Users.read();return [value,calls,ran,args]`, `[7,0,1,0]`, `[0,1,0]`},
		{"effect-value-chain", `return (Users.read()).toFixed()`, `"7"`, `[0,1,0]`},
		{"tried-effect", `const value=try Users.find(arg());return [value,calls,ran,args]`, `["42",1,1,1]`, `[1,1,1]`},
		{"held-effect", `const value=Users.find(arg());return [Effect.isEffect(value),calls,ran,args]`, `[true,1,0,1]`, `[1,0,1]`},
		{"plain-method", `const value=Users.value();return [value,calls,ran,args]`, `[7,1,0,0]`, `[1,0,0]`},
		{"tried-plain", `const value=try Users.value();return [value,calls,ran,args]`, `[7,1,0,0]`, `[1,0,0]`},
		{"group-newline", "return try (\nUsers.value()\n)", `7`, `[1,0,0]`},
		{"return-block-comment", `return try /* lookup */ Users.value()`, `7`, `[1,0,0]`},
		{"group-line-comment", "return try (// lookup\nUsers.value())", `7`, `[1,0,0]`},
		{"parenthesized", `return try (Users.value())`, `7`, `[1,0,0]`},
		{"asi", "let prior=2\ntry Users.value()\nreturn [prior,calls,ran,args]", `[2,1,0,0]`, `[1,0,0]`},
	} {
		for _, migrationOnly := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/migration=%v", tc.name, migrationOnly), func(t *testing.T) {
				source := `interface Shape { find(id:string):string!!;value():number;read:number!! }
service Users:Shape {static readonly key="phase/Users"}
let calls=0;let ran=0;let args=0;
function arg():string {args++;return "42"}
const live=Layer.succeed(Users,{find:(id:string)=>{calls++;return Effect.sync(()=>{ran++;return id})},value:()=>{calls++;return 7},read:Effect.sync(()=>{ran++;return 7})})
export function traceOf(){return [calls,ran,args]}
export effect function main(){provide live {` + tc.body + `}}
`
				files := map[string]string{"main.vibe": source, "package.json": `{"type":"module"}`}
				before, err := w.Compile(t.Context(), Project{Files: files})
				if err != nil {
					t.Fatal(err)
				}
				defer before.Remove()
				options := vibelang.FixOptions{MigrationOnly: migrationOnly}
				result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
				fixed := maps.Clone(files)
				for name, file := range result.Files {
					fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
				}
				if result.Err != nil || len(result.Refused) > 0 || fixed["main.vibe"] == source {
					t.Fatalf("missing migration: err=%v refused=%+v\n%s", result.Err, result.Refused, source)
				}
				if lost := toolsLostComments(source, fixed["main.vibe"]); len(lost) > 0 {
					t.Fatalf("comments lost: %v", lost)
				}
				after, err := w.Compile(t.Context(), Project{Files: fixed})
				if err != nil {
					t.Fatal(err)
				}
				defer after.Remove()
				if errs := legacyErrors(after); len(errs) > 0 {
					t.Fatalf("fixed source rejected: %v\n%s", errs, fixed["main.vibe"])
				}
				got := node.RunObserved(after, "out/main.js", "main")
				if got.Kind != "success" || string(got.Value) != tc.want || string(got.BeforeCall) != "[0,0,0]" || string(got.AfterCall) != "[0,0,0]" || string(got.Trace) != tc.trace {
					t.Fatalf("changed phase: got=%+v want=%s trace=%s\n%s", got, tc.want, tc.trace, fixed["main.vibe"])
				}
				again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
				if again.Err != nil || len(again.Files) > 0 {
					t.Fatalf("not a fixed point: %+v", again)
				}
			})
		}
	}
}

func serviceMemberControlRetirementQuoted(t testing.TB) {
	t.Helper()
	const quote = "The first-release retirement diagnostics are `EK3501` for `control` and `handle` syntax"
	if !strings.Contains(SpecText("000-intro.md"), quote) {
		t.Fatalf("retirement rule no longer says %q", quote)
	}
}
func TestServiceMemberControlRetirementQuoted(t *testing.T) { serviceMemberControlRetirementQuoted(t) }
func TestServiceMemberControlRetirementPreserved(t *testing.T) {
	serviceMemberControlRetirementQuoted(t)
	for _, tc := range []struct {
		name, tail string
		repair     bool
	}{
		{"tail-resume", "return try resume(7)", true},
		{"tail-statement", "try resume(7)", true},
		{"non-tail-resume", "const result = try resume(7); return result + 1", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := NewWorkspace(t)
			source := "control Ask {ask():number!!}\nexport effect function main(){try {return try Ask.ask()} handle Ask.ask(){" + tc.tail + "}}"
			files := map[string]string{"main.vibe": source, "package.json": `{"type":"module"}`}
			r, err := w.Compile(t.Context(), Project{Files: files})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			errs := legacyErrors(r)
			if len(errs) != 2 || !strings.Contains(errs[0], " 3501:") || !strings.Contains(errs[1], " 3501:") {
				t.Fatalf("retired syntax must retain two EK3501 errors: %v", errs)
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, r.Dir), vibelang.FixOptions{MigrationOnly: true})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if !tc.repair {
				if len(result.Files) > 0 || len(result.Refused) == 0 {
					t.Fatalf("non-tail continuation must be retained with a refusal: %+v", result)
				}
				return
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[filepath.Base(name.AsString())] = file.Text
			}
			if len(result.Refused) != 0 || !strings.Contains(fixed["main.vibe"], "service Ask") || strings.Contains(fixed["main.vibe"], "resume(") {
				t.Fatalf("missing preserving service migration: %+v\n%s", result, fixed["main.vibe"])
			}
			after, err := w.Compile(t.Context(), Project{Files: fixed})
			if err != nil {
				t.Fatal(err)
			}
			defer after.Remove()
			if errs := legacyErrors(after); len(errs) > 0 {
				t.Fatalf("service migration rejected: %v", errs)
			}
			node, err := NewNode(w.Dir)
			if err != nil {
				t.Fatal(err)
			}
			defer node.Close()
			got := node.Run(after, "out/main.js", "main")
			if got.Kind != "success" || string(got.Value) != "7" {
				t.Fatalf("migrated result changed: %+v", got)
			}
		})
	}
}

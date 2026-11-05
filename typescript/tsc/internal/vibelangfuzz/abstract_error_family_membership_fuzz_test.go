package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestAbstractErrorFamilyMembershipQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), "Any other class uses `instanceof`") {
		t.Fatal("native class matching authority changed")
	}
}
func FuzzAbstractErrorFamilyMembership(f *testing.F) {
	startShortBudget(f)
	for kind := uint8(0); kind < 6; kind++ {
		for alias := uint8(0); alias < 3; alias++ {
			f.Add(kind, alias, uint8(0))
			f.Add(kind, alias, uint8(17))
		}
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, kind, alias, tag uint8) {
		TestAbstractErrorFamilyMembershipQuoted(t)
		const target = "FuzzAbstractErrorFamilyMembership"
		name := fmt.Sprintf("Root%d", tag)
		child := fmt.Sprintf("Child%d", tag)
		declarations := "import {Data as NativeData} from 'effect';import {$errorSubclass,$is} from 'vibelang-runtime';\n" +
			"abstract error " + name + " {value:number}\n" +
			"class Child extends $errorSubclass(" + name + "," + fmt.Sprintf("%q", child) + ") {}\nclass Grandchild extends Child {}\nclass Ordinary extends " + name + " {}\n" +
			"abstract class Reference extends NativeData.TaggedError(" + fmt.Sprintf("%q", name) + " as string)<{readonly _tag:string;readonly value:number}> {}\n" +
			"class ReferenceChild extends $errorSubclass(Reference," + fmt.Sprintf("%q", child) + ") {}\nclass ReferenceGrandchild extends ReferenceChild {}\nclass ReferenceOrdinary extends Reference {}\n" +
			"const Alias=" + name + ";namespace Patterns {export const RootAlias=" + name + "}\n"
		left := []string{"new Child({value:1})", "new Grandchild({value:1})", "new Ordinary({value:1})", "{_tag:'Other',value:1}", "{_tag:" + fmt.Sprintf("%q", name) + ",value:1}", "null"}[kind%6]
		right := []string{"new ReferenceChild({value:1})", "new ReferenceGrandchild({value:1})", "new ReferenceOrdinary({value:1})", "{_tag:'Other',value:1}", "{_tag:" + fmt.Sprintf("%q", name) + ",value:1}", "null"}[kind%6]
		pattern := []string{name, "Alias", "Patterns.RootAlias"}[alias%3]
		source := declarations + "export function main(){const left=" + left + ",right=" + right + ";return [left is " + pattern + ",$is(Reference,right),left instanceof " + name + ",right instanceof Reference]}"
		// The subjects stay unknown so native instanceof remains a legal control for primitives.
		source = strings.ReplaceAll(source, "const left=", "const left:unknown=")
		source = strings.ReplaceAll(source, ",right=", ",right:unknown=")
		toolsGuard(t, target, func() {
			r := toolsCompile(t, w, target, map[string]string{"main.vibe": source, "runner.ts": "import {Effect} from \"effect\";import {main as inspect} from \"./main.js\";export const main=()=>Effect.succeed(inspect());"})
			defer r.Remove()
			if !toolsErrorFree(r) {
				t.Fatalf("family controls: %v", SortedKeys(Keys(r.Dir, r.Diagnostics)))
			}
			outcome := node.Run(r, "out/runner.js", "main")
			var got []bool
			if toolsInvalidOutcome(outcome) || json.Unmarshal(outcome.Value, &got) != nil || len(got) != 4 {
				t.Fatalf("invalid family observation: %+v", outcome)
			}
			instance := kind%6 < 3
			if got[0] != got[1] || got[2] != instance || got[3] != instance {
				t.Fatalf("legacy matcher differs from native family: kind=%d alias=%d got=%v", kind%6, alias%3, got)
			}
		})
	})
}

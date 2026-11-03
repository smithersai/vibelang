package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

var contractProbeFixtures = []struct{ name, source string }{
	{"private-function", "function hidden(value: number) { return value }; export type Fn = typeof hidden"},
	{"private-constant", "const hidden: (value: number) => number = value => value; export type Fn = typeof hidden"},
	{"private-generic", "function hidden<T>(value: T, count: number) { return value }; export type Fn = typeof hidden"},
	{"private-overloads", "function hidden(value: number): number; function hidden(value: string): string; function hidden(value: number | string) { return value }; export type Fn = typeof hidden"},
	{"private-effect", "effect function hidden(value: number) { return value }; export type Fn = typeof hidden"},
	{"public-alias", "function hidden(value: number) { return value }; export { hidden as visible }"},
	{"public-function", "export function visible(value: number) { return value }"},
	{"named-default", "export default function visible(value: number) { return value }"},
	{"anonymous-default", "export default function(value: number) { return value }"},
}

const contractProbePackage = `{"type":"module"}`

func contractProbeQuoted(t testing.TB) {
	t.Helper()
	quote := "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
}
func TestContractProbeQuoted(t *testing.T) { contractProbeQuoted(t) }

// A private callable can occur in a public type without becoming an export.
// Keep its contract checked, but do not invent an actual module export.
func TestToolsContractPrivateProbe(t *testing.T) {
	w := NewWorkspace(t)
	for _, tc := range contractProbeFixtures {
		t.Run(tc.name, func(t *testing.T) {
			checkContractProbe(t, w, tc.source)
		})
	}
}

func checkContractProbe(t *testing.T, w *Workspace, source string) {
	t.Helper()
	before := toolsCompile(t, w, "FuzzContractProbe", map[string]string{"main.vibe": source, "package.json": contractProbePackage})
	defer before.Remove()
	if !toolsErrorFree(before) {
		t.Fatalf("invalid fixture: %v", legacyErrors(before))
	}
	if mismatch := toolsContractMismatch(t, w, before, before, false); mismatch != "" {
		t.Fatalf("unchanged private contract failed: %s", mismatch)
	}
	changed := toolsCompile(t, w, "FuzzContractProbe", map[string]string{"main.vibe": strings.ReplaceAll(source, "number", "string"), "package.json": contractProbePackage})
	defer changed.Remove()
	if !toolsErrorFree(changed) {
		t.Fatalf("invalid changed fixture: %v", legacyErrors(changed))
	}
	mismatch := toolsContractMismatch(t, w, before, changed, false)
	if !strings.Contains(mismatch, "not assignable") {
		t.Fatalf("changed contract must fail assignability: %q", mismatch)
	}
}

// Metamorphic oracle: a declaration compares equal to itself; a changed
// parameter contract must still fail both-direction assignability. Vary private
// functions, callable constants, overloads, generics, Effect factories, local
// re-exports, defaults, Unicode binding names and probe-name collisions.
func FuzzContractProbe(f *testing.F) {
	startShortBudget(f)
	contractProbeQuoted(f)
	for _, tc := range contractProbeFixtures {
		f.Add([]byte(tc.name))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, _, _ := strings.Cut(string(data), "@")
		selected := len(data) % len(contractProbeFixtures)
		for i, tc := range contractProbeFixtures {
			if key == tc.name {
				selected = i
				break
			}
		}
		source := strings.ReplaceAll(contractProbeFixtures[selected].source, "hidden", fmt.Sprintf("hidden_λ%d", len(data)%17))
		if len(data)%2 == 0 {
			source = "export declare const __vibelangContract0: boolean;\n" + source
		}
		checkContractProbe(t, w, source)
	})
}

// Adding a probe must not turn other implicitly exported ambient declarations
// private. This declaration-only module is valid native TypeScript.
func TestToolsContractProbeImplicitExports(t *testing.T) {
	w := NewWorkspace(t)
	r := &Result{Outputs: map[string]string{
		"out/library.d.ts": "declare function echo(value: number): number; declare class Item { value: number }; export interface Public { tag: string }",
		"out/main.d.ts":    "import type { Item } from './library.js'; export declare function consume(value: Item): number;",
	}}
	if mismatch := toolsContractMismatch(t, w, r, r, false); mismatch != "" {
		t.Fatalf("probe hid an ambient export: %s", mismatch)
	}
}

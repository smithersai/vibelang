package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// The experimental gate, read from VIP-30's clarified bullet and the
// configuration chapter: what is built from the open built-in set compiles
// only with "vibe": { "experimental": ["builtins"] }, and without it a file's
// first gated use is EK3013, once. Each generated file joins uses from a keyed
// pool; the oracle is whether any is gated, and the opt-in, from the quotes.
var experimentalGateQuotes = []string{
	"Without the opt-in, a file's first gated use is the error `EK3013`, once per file, naming the open proposal and the opt-in, and the durable checks of VIP-55 do not run.",
	"VIP-33's platform modules under `Experimental`, such as `Experimental.FileSystem`, `Experimental.Process`, `Experimental.Crypto` and `Experimental.Encoding`, are core and need no opt-in.",
	"`task` and `workflow` stay ordinary identifiers everywhere they are today, and the parse does not depend on the setting, so the formatter and the language server read the same tree either way.",
}

func experimentalGateQuoted(tb testing.TB) {
	tb.Helper()
	data, err := os.ReadFile(filepath.Join(Root(), "docs/design/vips", "0030-config-files.md"))
	if err != nil {
		tb.Fatal(err)
	}
	vip := string(data)
	for _, quote := range experimentalGateQuotes {
		if !strings.Contains(vip, quote) {
			tb.Fatalf("experimental gate rule changed: %q", quote)
		}
	}
	if !strings.Contains(SpecText("007-tooling.md"), "| `vibe.experimental` |") {
		tb.Fatal("the configuration chapter no longer lists vibe.experimental")
	}
}

func TestExperimentalGateRulesQuoted(t *testing.T) { experimentalGateQuoted(t) }

// gateUse is one top-level use; gated says whether the quotes gate it.
type gateUse struct {
	key, source string
	gated       bool
}

var gateUses = []gateUse{
	{"task", "task Fetch%d { effect call(id: string): number!string { return id.length } }", true},
	{"workflow", "workflow Run%d { effect call(id: string) { return id.length } }", true},
	{"durable", "export const d%d = Experimental.Durable.memory", true},
	{"human", "export const h%d = Experimental.Human", true},
	{"eval", "export const e%d = Experimental.Eval", true},
	{"scorer", "export const s%d = Experimental.Scorer", true},
	{"memory", "export const m%d = Experimental.Memory", true},
	{"fuzz", "export const f%d = Experimental.Fuzz", true},
	{"simulation", "export const g%d = Experimental.FuzzSimulation", true},
	{"test", "export const t%d = Experimental.Test", true},
	{"patterns", "export const pt%d = Experimental.Patterns.Panel.run", true},
	{"pattern-subpath", "import * as PS%d from \"vibelang-runtime/experimental/patterns/Panel\"\nexport const ps%[1]d = PS%[1]d.run", true},
	{"barrel", "import { Durable as D%d } from \"vibelang-runtime/experimental\"\nexport const b%[1]d = D%[1]d", true},
	{"subpath", "import * as M%d from \"vibelang-runtime/experimental/Memory\"\nexport const p%[1]d = M%[1]d", true},
	// The gate decides by what a reference resolves to, so every other way to
	// reach a gated module is gated too, and the same forms on a core module or
	// a user's own binding are not.
	{"alias", "const E%d = Experimental\nexport const a%[1]d = E%[1]d.Durable.memory", true},
	{"destructure", "function ds%d() { const { Memory } = Experimental; return Memory }\nexport { ds%[1]d }", true},
	{"destructure-renamed", "const { Fuzz: Fz%d } = Experimental\nexport const fz%[1]d = Fz%[1]d", true},
	{"element", "export const el%d = Experimental[\"Durable\"]", true},
	{"typeof", "export type T%d = typeof Experimental.Durable.memory", true},
	{"type-name", "export type R%d = Experimental.Fuzz.Report<number, never>", true},
	{"parenthesized", "export const pr%d = (Experimental as typeof Experimental).Fuzz", true},
	{"root-barrel", "import { Experimental as X%d } from \"vibelang-runtime\"\nexport const x%[1]d = X%[1]d.Human", true},
	{"helpers", "import * as RT%d from \"vibelang-runtime\"\nexport const h%[1]d = RT%[1]d.$task", true},
	{"namespace-barrel", "import * as NB%d from \"vibelang-runtime/experimental\"\nexport const nb%[1]d = NB%[1]d.Scorer", true},
	{"export-star", "export * from \"vibelang-runtime/experimental\" // %d", true},
	{"export-star-as", "export * as ES%d from \"vibelang-runtime/experimental\"", true},
	{"dynamic-import", "export async function di%d() { return await import(\"vibelang-runtime/experimental/Durable\") }", true},
	{"import-type", "export type IT%d = typeof import(\"vibelang-runtime/experimental/Eval\")", true},
	{"core-alias", "const C%d = Experimental\nexport const ca%[1]d = C%[1]d.Encoding", false},
	{"core-destructure", "const { NetAddress: NA%d } = Experimental\nexport const cd%[1]d = NA%[1]d", false},
	{"core-element", "export const ce%d = Experimental[\"Locks\"]", false},
	{"core-typeof", "export type CT%d = typeof Experimental.Locks", false},
	{"core-namespace-barrel", "import * as CB%d from \"vibelang-runtime/experimental\"\nexport const cb%[1]d = CB%[1]d.Encoding", false},
	{"shadow-destructure", "function sd%d() { const Experimental = { Memory: 2 }; const { Memory } = Experimental; return Memory + Experimental[\"Memory\"] }\nexport { sd%[1]d }", false},
	{"own-object", "const o%d = { Durable: 1, Test: 2 }\nexport const od%[1]d = o%[1]d.Durable + o%[1]d[\"Test\"]", false},
	{"encoding", "export const c%d = Experimental.Encoding.decodeBase64Lenient(\"aGk=\")", false},
	{"netaddress", "export const n%d = Experimental.NetAddress", false},
	{"platform", "import { ExperimentalNodeServices as N%d } from \"vibelang-runtime/experimental/platform-node\"\nexport const l%[1]d = N%[1]d", false},
	{"task-ident", "const task%d = 1\nexport const task_%[1]d = task%[1]d as number", false},
	{"workflow-member", "const workflow%d = { run: () => 1 }\nexport const r%[1]d = workflow%[1]d.run()", false},
	{"shadow", "function shadow%d() { const Experimental = { Durable: 1 }; return Experimental.Durable }\nexport { shadow%[1]d }", false},
	{"pure", "export const v%d = 1", false},
}

func gateUseByKey(key string) gateUse {
	if i := slices.IndexFunc(gateUses, func(u gateUse) bool { return u.key == key }); i >= 0 {
		return gateUses[i]
	}
	if key == "" {
		return gateUses[len(gateUses)-1]
	}
	return gateUses[int(key[0])%len(gateUses)]
}

// builtinsConfig is DefaultConfig listing files, with the opt-in when on.
func builtinsConfig(files map[string]string, on bool) string {
	var names []string
	for name := range files {
		if isSource(name) {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	listed, _ := json.Marshal(names)
	config := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": " + string(listed)
	if on {
		config += ",\n  \"vibe\": { \"experimental\": [\"builtins\"] }"
	}
	return config + "\n}"
}

// builtinsProject is a project of files that opts in to the built-in set.
func builtinsProject(files map[string]string) Project {
	return Project{Files: files, Config: builtinsConfig(files, true)}
}

func FuzzExperimentalGate(f *testing.F) {
	startShortBudget(f)
	experimentalGateQuoted(f)
	for _, u := range gateUses {
		f.Add(u.key, "", "", false)
		f.Add("pure", u.key, "encoding", true)
	}
	f.Add("task", "workflow", "durable", false)
	f.Add("shadow", "task-ident", "workflow-member", false)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, first, second, third string, on bool) {
		var keys, body []string
		gated := false
		for i, key := range []string{first, second, third} {
			if i > 0 && key == "" {
				continue
			}
			u := gateUseByKey(key)
			keys = append(keys, u.key)
			body = append(body, fmt.Sprintf(u.source, i+1))
			gated = gated || u.gated
		}
		files := map[string]string{"main.vibe": strings.Join(body, "\n") + "\nexport {}\n", "package.json": `{"type":"module"}`}
		r, err := w.Compile(t.Context(), Project{Files: files, Config: builtinsConfig(files, on)})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		var other []string
		for _, d := range r.Diagnostics {
			switch key := diagnosticKey(d); {
			case key == "EK3013":
				count++
				if !strings.Contains(d.MessageText(), `"vibe": { "experimental": ["builtins"] }`) {
					Gap(t, "FuzzExperimentalGate", "message:"+strings.Join(keys, "+"), "EK3013 does not name the opt-in: %s", d.MessageText())
				}
			case strings.HasPrefix(key, "EK55"):
				if !on {
					other = append(other, key)
				}
			case strings.HasPrefix(key, "TS") || strings.HasPrefix(key, "EK"):
				other = append(other, key)
			}
		}
		want := 0
		if gated && !on {
			want = 1
		}
		if count != want {
			Gap(t, "FuzzExperimentalGate", fmt.Sprintf("count:%v:%s", on, strings.Join(keys, "+")), "EK3013 reported %d times, want %d", count, want)
		}
		if len(other) > 0 {
			Gap(t, "FuzzExperimentalGate", fmt.Sprintf("other:%v:%s", on, strings.Join(keys, "+")), "unexpected diagnostics %v", other)
		}
	})
}

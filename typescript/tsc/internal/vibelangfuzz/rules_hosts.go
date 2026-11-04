package vibelangfuzz

import (
	"encoding/json"
	"slices"
	"strings"
	"sync"
)

// The rule targets inject one violation, or one allowed form, into a host: a
// valid program with insertion points. A slot marker, ⟪name⟫, stands where an
// injection may go; rendering replaces each marker with the injection or with
// nothing. TestSpecRuleHosts checks that every host compiles with no error,
// since an oracle that compares a host with and without an injection means
// nothing over a host that is already wrong.

// Slots: where an injection's text may go.
const (
	slotTop        = "top"        // a .vibe module's top level
	slotEffect     = "effect"     // a statement of an Effect function's body
	slotPlain      = "plain"      // a statement of a function that runs no Effect
	slotMember     = "member"     // a member of a class
	slotHatch      = "hatch"      // a statement of a sync hatch's function
	slotAsyncHatch = "asynchatch" // a statement of an async hatch's function
	slotModule     = "module"     // a statement of a function in a module declaration's body
	slotTS         = "ts"         // a .ts file's top level
	slotFile       = "file"       // a new .vibe module of its own
	slotNoEffect   = "noeffect"   // the top level of a program that cannot resolve effect
)

// statementSlots are the slots inside a function body, where an injection
// may be nested in blocks.
var statementSlots = []string{slotEffect, slotPlain, slotHatch, slotAsyncHatch, slotModule}

// A ruleHost is one host program. Files hold slot markers; Main is the .vibe
// file whose ⟪top⟫ receives an injection's declarations.
type ruleHost struct {
	Name     string
	Files    map[string]string
	Config   string // tsconfig.json; empty means DefaultConfig listing every source
	Main     string
	DOM      bool // the program's libraries declare the DOM's globals
	NewFiles bool // a new file in the project directory joins the program
}

func (h *ruleHost) slots() []string {
	var slots []string
	for _, slot := range []string{slotTop, slotEffect, slotPlain, slotMember, slotHatch, slotAsyncHatch, slotModule, slotTS, slotNoEffect} {
		for _, text := range h.Files {
			if strings.Contains(text, "⟪"+slot+"⟫") {
				slots = append(slots, slot)
				break
			}
		}
	}
	if h.NewFiles {
		slots = append(slots, slotFile)
	}
	return slots
}

// templateHosts are hand-written hosts that between them offer every slot,
// each in a program that uses services, errors, data types, matches,
// catches, producers, hatches and modules around it.
var templateHosts = []*ruleHost{
	{
		Name: "template:minimal",
		Main: "main.vibe",
		Files: map[string]string{"main.vibe": `⟪top⟫
function slotEffect() {
  Console.log("effect slot");
  ⟪effect⟫
  return 1;
}

function slotPlain(n: number) {
  const m = n + 1;
  ⟪plain⟫
  return m;
}

export function main() {
  Console.log("main");
}
`},
	},
	{
		Name: "template:services",
		Main: "main.vibe",
		Files: map[string]string{"main.vibe": `error HostMissing { id: string }

service HostUsers {
  name(id: string): string!HostMissing
}

const HostUsersLive = Layer.succeed(HostUsers, {
  name(id) {
    if (id === "") throw new HostMissing({ id });
    return id.toUpperCase();
  }
});

data HostShape {
  Circle { radius: number }
  Square { side: number }
}

function hostArea(shape: HostShape) {
  return match (shape) {
    when { _tag: "Circle", let radius }: radius * radius * 3;
    when { _tag: "Square", let side }: side * side;
  };
}

⟪top⟫

function slotEffect(id: string) {
  const name = HostUsers.name(id) catch (e) => e.id;
  ⟪effect⟫
  return name;
}

class HostBox {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
  ⟪member⟫
  double() {
    return this.value * 2;
  }
}

export function main() {
  provide HostUsersLive {
    Console.log(hostArea(HostShape.Circle({ radius: 2 })), new HostBox(2).double());
    return HostUsers.name("ada") catch (e) => e.id;
  }
}
`},
	},
	{
		Name: "template:escapes",
		Main: "main.vibe",
		Files: map[string]string{"main.vibe": `module hostText {
  export function clean(s: string): string {
    ⟪module⟫
    return s.trim();
  }
}

import { clean } from hostText

⟪top⟫

export function slotEffect(text: string) {
  const cleaned = sync((t) => clean(t), text);
  ⟪effect⟫
  return cleaned;
}

export function slotHatch() {
  return sync(() => {
    ⟪hatch⟫
    return 1;
  });
}

export function slotAsyncHatch() {
  return sync(async () => {
    ⟪asynchatch⟫
    return 2;
  });
}
`},
	},
	{
		Name: "template:typescript",
		Main: "main.vibe",
		Files: map[string]string{
			"main.vibe": `import { hostValue } from "./helper.js"

⟪top⟫

export function slotEffect() {
  Console.log(hostValue);
  ⟪effect⟫
  return hostValue;
}
`,
			"helper.ts": `export const hostValue = 1;
⟪ts⟫
`,
		},
	},
	{
		Name: "template:contracts",
		Main: "main.vibe",
		Files: map[string]string{"main.vibe": `error HostBad { reason: string }

function hostParse(text: string): number!HostBad! {
  const n = Number(text);
  if (Number.isNaN(n)) throw new HostBad({ reason: text });
  return n;
}

function* hostCount(limit: number) {
  for (let i = 0; i < limit; i++) yield i;
}

⟪top⟫

export function slotEffect(texts: ReadonlyArray<string>) {
  let total = 0;
  for (const text of texts) {
    total += hostParse(text) catch 0;
  }
  for (const n of hostCount(3)) {
    total += n;
  }
  ⟪effect⟫
  return total;
}

export function slotPlain(values: ReadonlyArray<number>): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  ⟪plain⟫
  return total;
}
`},
	},
}

// noEffectHost is a program whose directory installs packages named effect
// and vibelang-runtime that hold no declarations, so that nothing it imports
// resolves effect's Effect type: the one place EK1011 can be drawn (D4).
var noEffectHost = &ruleHost{
	Name: "template:no-effect",
	Main: "main.vibe",
	Files: map[string]string{
		"main.vibe": `export function hostAdd(a: number, b: number): number {
  return a + b;
}

⟪noeffect⟫
`,
		"node_modules/effect/package.json":           emptyPackage("effect"),
		"node_modules/effect/index.d.ts":             "export {}\n",
		"node_modules/vibelang-runtime/package.json": emptyPackage("vibelang-runtime"),
		"node_modules/vibelang-runtime/index.d.ts":   "export {}\n",
	},
}

// emptyPackage is the package.json of a package whose every entry point is
// an empty declaration file.
func emptyPackage(name string) string {
	return `{"name":"` + name + `","version":"0.0.0","type":"module","types":"./index.d.ts","exports":{".":{"types":"./index.d.ts"},"./*":{"types":"./index.d.ts"}}}`
}

func init() {
	templateHosts = append(templateHosts, noEffectHost)
	for _, host := range templateHosts {
		host.DOM = true // DefaultConfig names no lib, so ES2022's default libraries hold the DOM's.
		host.NewFiles = host != noEffectHost
	}
}

// caseHosts are the runnable acceptance cases (an expect-result line and no
// pending file), each with a top-level slot at the end of the file that holds
// the expected result and, after it, an Effect function and a plain function
// with a statement slot. A case that sets an EK code's category, in its
// tsconfig.json or a comment, is left out: it would change what an injection
// reports. So is a case whose tsconfig.json makes valid code an error, such
// as an unused local, which an injection's own statements would draw.
var caseHosts = sync.OnceValue(func() []*ruleHost {
	var hosts []*ruleHost
	for _, seed := range CaseSeeds() {
		if seed.ExpectResult == "" || seed.Pending != "" {
			continue
		}
		config := seed.Files["tsconfig.json"]
		if strings.Contains(config, "diagnostics") || strings.Contains(config, "trustedPackages") || strictFlag(config) {
			continue
		}
		main := ""
		skip := false
		for name, text := range seed.Files {
			if strings.Contains(text, "@vibelang-diagnostics") {
				skip = true
			}
			if strings.HasSuffix(name, ".vibe") && strings.Contains(text, "// expect-result:") && (main == "" || name < main) {
				main = name
			}
		}
		if skip || main == "" || strings.Contains(main, "/") {
			continue
		}
		files := map[string]string{}
		for name, text := range seed.Files {
			if name != "tsconfig.json" {
				files[name] = text
			}
		}
		files[main] = strings.TrimRight(files[main], "\n") + `

⟪top⟫

function slotEffectInjected() {
  Console.log("effect slot");
  ⟪effect⟫
  return 1;
}

function slotPlainInjected(n: number) {
  const m = n + 1;
  ⟪plain⟫
  return m;
}
`
		hosts = append(hosts, &ruleHost{
			Name:   "case:" + seed.Name,
			Files:  files,
			Config: config,
			Main:   main,
			DOM:    configHasDOM(config),
		})
	}
	slices.SortFunc(hosts, func(a, b *ruleHost) int { return strings.Compare(a.Name, b.Name) })
	return hosts
})

// strictFlag reports whether a tsconfig turns on a check that makes valid
// code an error, such as an unused local or unreachable code, which an
// injection's own statements would draw.
func strictFlag(config string) bool {
	for _, flag := range []string{"noUnused", "noImplicitReturns", "allowUnreachableCode", "noFallthroughCasesInSwitch", "exactOptionalPropertyTypes", "noUncheckedIndexedAccess", "noPropertyAccessFromIndexSignature", "isolatedDeclarations", "verbatimModuleSyntax", "erasableSyntaxOnly"} {
		if strings.Contains(config, flag) {
			return true
		}
	}
	return false
}

// configHasDOM reports whether a tsconfig's libraries declare the DOM's
// globals: it names no lib, or names one that starts with "dom".
func configHasDOM(config string) bool {
	var parsed struct {
		CompilerOptions struct {
			Lib []string `json:"lib"`
		} `json:"compilerOptions"`
	}
	if json.Unmarshal([]byte(config), &parsed) != nil {
		return false
	}
	if parsed.CompilerOptions.Lib == nil {
		return true
	}
	return slices.ContainsFunc(parsed.CompilerOptions.Lib, func(lib string) bool { return strings.HasPrefix(strings.ToLower(lib), "dom") })
}

// allRuleHosts returns the template hosts, then the case hosts.
func allRuleHosts() []*ruleHost {
	return append(slices.Clone(templateHosts), caseHosts()...)
}

// benign statements surround an injection without changing what it reports:
// each is valid in its slot, declares only names of its own and ends with a
// semicolon, so no following line can join it.
var benign = map[string][]string{
	slotTop: {
		"const bnTop1$$ = 1;",
		"function bnTop2$$(n: number) {\n  return n + 1;\n}",
		"interface BnTop3$$ { a: number }",
		"error BnTop4$$ { a: number }",
		"export const bnTop5$$ = [1, 2, 3].map((n) => n * 2);",
	},
	slotEffect: {
		"const bn1$$ = 1;",
		"Console.log(\"benign\");",
		"let bn2$$ = [1, 2].map((n) => n * 2);",
		"const bn3$$ = { a: 1, b: \"two\" };",
	},
	slotPlain: {
		"const bn1$$ = 1;",
		"let bn2$$ = \"text\".length;",
		"const bn3$$ = [1, 2].filter((n) => n > 1);",
	},
	slotMember: {
		"readonly bnm1$$ = 1;",
		"bnm2$$(n: number) {\n    return n + 1;\n  }",
	},
	slotHatch: {
		"const bh1$$ = 1;",
		"let bh2$$ = [1].map((n) => n + 1);",
	},
	slotAsyncHatch: {
		"const bh1$$ = 1;",
		"let bh2$$ = [1].map((n) => n + 1);",
	},
	slotModule: {
		"const bm1$$ = 1;",
		"let bm2$$ = [1].map((n) => n + 1);",
	},
	slotTS: {
		"export const bt1$$ = 1;",
		"export function bt2$$(n: number) {\n  return n + 1;\n}",
	},
	slotFile: {
		"const bnf1$$ = 1;",
		"function bnf2$$(n: number) {\n  return n + 1;\n}",
	},
}

// nestings wrap an injection in a statement slot; each opens a block that
// changes neither what the injection's statements mean nor what they report.
var nestings = [][2]string{
	{"{", "}"},
	{"if (1 + 1 === 2) {", "}"},
	{"for (const nest$$ of [1]) {", "}"},
}

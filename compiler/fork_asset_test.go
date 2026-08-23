package compiler

import (
	"sort"
	"strings"
	"testing"
)

// TestPinnedForkAssetImportSelection pins the fail-closed half of source
// assets independently of the conformance harness. Assets use their real wire
// kind here; one compatibility row also proves the older non-root
// "typescript" staging label is recovered without changing a code root.
func TestPinnedForkAssetImportSelection(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	type assetCase struct {
		name      string
		source    string
		assetPath string
		assetKind FileKind
		assetText string
		want      []string
	}
	cases := []assetCase{
		{
			name:      "missing type attribute is owned by loader selection",
			source:    "import counter from \"./counter.json\"\nexport function main(): string[] { return [counter.label] }\n",
			assetPath: "counter.json", assetKind: FileKindAsset,
			assetText: `{"count":3,"label":"widgets"}`,
			want:      []string{"SMITHERS5201@1:1"},
		},
		{
			name:      "legacy assert clause is rejected at the recovered attribute node",
			source:    "import counter from \"./counter.json\" assert { type: \"json\" }\nexport function main(): string[] { return [counter.label] }\n",
			assetPath: "counter.json", assetKind: FileKindAsset,
			assetText: `{"count":3,"label":"widgets"}`,
			want:      []string{"SMITHERS5202@1:38"},
		},
		{
			name:      "type-only asset import is rejected at the declaration",
			source:    "import type counter from \"./counter.json\" with { type: \"json\" }\nexport type Counter = typeof counter\n",
			assetPath: "counter.json", assetKind: FileKindAsset,
			assetText: `{"count":3,"label":"widgets"}`,
			want:      []string{"SMITHERS5208@1:1"},
		},
		{
			name:      "escaping asset specifier is rejected at the specifier",
			source:    "import counter from \"../counter.json\" with { type: \"json\" }\nexport function main(): string[] { return [counter.label] }\n",
			assetPath: "counter.json", assetKind: FileKindAsset,
			assetText: `{"count":3,"label":"widgets"}`,
			want:      []string{"SMITHERS5209@1:21"},
		},
		{
			name:      "an unimplemented custom loader remains honestly unsupported",
			source:    "import settings from \"./settings.yaml\" with { type: \"yaml\" }\nexport function main(): string[] { return [`${settings}`] }\n",
			assetPath: "settings.yaml", assetKind: FileKindAsset,
			assetText: "retries: 2\n",
			want:      []string{"SMITHERS_GO_ASSET_LOADER_UNSUPPORTED@1:1"},
		},
		{
			name:      "legacy harness non-root kind still exposes missing selection",
			source:    "import counter from \"./counter.json\"\nexport function main(): string[] { return [counter.label] }\n",
			assetPath: "counter.json", assetKind: FileKindTypeScript,
			assetText: `{"count":3,"label":"widgets"}`,
			want:      []string{"SMITHERS5201@1:1"},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			files := []SourceFile{
				{Path: "main.sm", Kind: FileKindSmithers, Text: testCase.source},
				{Path: testCase.assetPath, Kind: testCase.assetKind, Text: testCase.assetText},
			}
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.sm"},
				Files:     files,
				Options:   Options{},
				Lowering:  LoweringInternal,
			})
			if err != nil {
				t.Fatal(err)
			}
			observed := formatDiagnosticPositions(t, files, result)
			want := append([]string(nil), testCase.want...)
			sort.Strings(want)
			if strings.Join(observed, " ") != strings.Join(want, " ") {
				t.Fatalf("diagnostics %v, want %v; raw %#v", observed, want, result.Diagnostics)
			}
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatalf("a rejected/unsupported asset edge must suppress emit: %v", artifactPaths(result.Artifacts))
			}
		})
	}
}

func compileAssetProgram(t *testing.T, source string, assets ...SourceFile) CompileResult {
	t.Helper()
	backend, ctx := newPinnedTestBackend(t)
	files := append([]SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}, assets...)
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     files,
		Options:   Options{},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestPinnedForkAssetAttributeShapeValidation(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	asset := SourceFile{Path: "config.json", Kind: FileKindAsset, Text: `{"answer":42}`}
	cases := []struct {
		name   string
		source string
		want   []string
	}{
		{
			name:   "attribute names use the static identifier grammar",
			source: "import config from \"./config.json\" with { type: \"json\", _mode: \"const\" }\nexport { config }\n",
			want:   []string{"SMITHERS5203@1:57"},
		},
		{
			name:   "duplicate attributes cannot replace loader selection",
			source: "import config from \"./config.json\" with { type: \"json\", type: \"text\" }\nexport { config }\n",
			want:   []string{"SMITHERS5204@1:57"},
		},
		{
			name:   "attribute values must be string literals",
			source: "const kind = \"json\"\nimport config from \"./config.json\" with { type: kind }\nexport { config }\n",
			want:   []string{"SMITHERS5201@2:1", "SMITHERS5205@2:49"},
		},
		{
			name:   "template literals do not become identity strings",
			source: "import config from \"./config.json\" with { type: `json` }\nexport { config }\n",
			want:   []string{"SMITHERS5201@1:1", "SMITHERS5205@1:49"},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			files := []SourceFile{
				{Path: "main.sm", Kind: FileKindSmithers, Text: testCase.source},
				asset,
			}
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.sm"},
				Files:     files,
				Options:   Options{},
				Lowering:  LoweringInternal,
			})
			if err != nil {
				t.Fatal(err)
			}
			observed := formatDiagnosticPositions(t, files, result)
			want := append([]string(nil), testCase.want...)
			sort.Strings(want)
			if strings.Join(observed, " ") != strings.Join(want, " ") {
				t.Fatalf("diagnostics %v, want %v; raw %#v", observed, want, result.Diagnostics)
			}
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatalf("an invalid attribute shape must suppress emit: %v", artifactPaths(result.Artifacts))
			}
		})
	}

	valid := compileAssetProgram(t,
		"import config from \"./config.json\" with { type: \"text\" }\nexport function main(): string[] { return [config] }\n",
		asset,
	)
	if valid.EmitSkipped || len(valid.Diagnostics) != 0 {
		t.Fatalf("one valid type attribute must still select its loader: %#v", valid.Diagnostics)
	}
	if got := runComptimeProgram(t, valid); got != `{"answer":42}` {
		t.Fatalf("text loader result = %q", got)
	}
}

func TestPinnedForkDynamicAssetImportsEmbedAtCompileTime(t *testing.T) {
	const source = `const moduleAwaited = await import("./config.json", { with: { type: "json", mode: "const" } })
const modulePending = import("./config.json", { with: { type: "json", mode: "const" } })
export async function main(): Promise<string[]> {
  const direct = await import("./config.json", { with: { type: "json", mode: "const" } })
  const functionPending = import(` + "`" + `./config.json` + "`" + `, { with: { type: "json", mode: "const" } })
  const stored = await functionPending
  const moduleStored = await modulePending
  return [moduleAwaited.default.mode, direct.default.mode, stored.default.mode, moduleStored.default.mode]
}
`
	result := compileAssetProgram(t, source, SourceFile{
		Path: "config.json", Kind: FileKindAsset, Text: `{"mode":"production","ports":[80,443]}`,
	})
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("literal dynamic asset imports must compile clean: %#v", result.Diagnostics)
	}
	if got := runEmittedMain(t, result); got != "production\nproduction\nproduction\nproduction" {
		t.Fatalf("dynamic asset runtime values = %q", got)
	}
	emitted := mainText(t, result)
	if strings.Contains(emitted, "config.json") || strings.Contains(emitted, "import(") || strings.Contains(emitted, " with ") {
		t.Fatalf("a compiler-owned dynamic asset edge reached runtime output:\n%s", emitted)
	}
	for _, artifact := range artifactPaths(result.Artifacts) {
		if strings.Contains(artifact, "config") || strings.Contains(artifact, "smithers-assets") {
			t.Fatalf("a checker-only asset module became a runtime artifact: %v", artifactPaths(result.Artifacts))
		}
	}
}

func TestPinnedForkDynamicAssetImportsFailClosed(t *testing.T) {
	asset := SourceFile{Path: "config.json", Kind: FileKindAsset, Text: `{"mode":"production"}`}
	tests := []struct {
		name   string
		source string
		want   string
	}{
		{
			name: "computed identifier specifier",
			source: `const chosen = "./config.json"

export async function main(): Promise<string[]> {
  const loaded = await import(chosen, { with: { type: "json" } })
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5218",
		},
		{
			name: "computed template specifier",
			source: `const name = "config"
export async function main(): Promise<string[]> {
  const loaded = await import(` + "`" + `./${name}.json` + "`" + `, { with: { type: "json" } })
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5218",
		},
		{
			name: "computed options object",
			source: `const options = { with: { type: "json" } } as const
export async function main(): Promise<string[]> {
  const loaded = await import("./config.json", options)
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5218",
		},
		{
			name: "legacy dynamic assertion",
			source: `export async function main(): Promise<string[]> {
  const loaded = await import("./config.json", { assert: { type: "json" } })
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5218",
		},
		{
			name: "spread dynamic attributes",
			source: `const selected = { type: "json" }
export async function main(): Promise<string[]> {
  const loaded = await import("./config.json", { with: { ...selected } })
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5218",
		},
		{
			name: "extra dynamic options argument",
			source: `export async function main(): Promise<string[]> {
  const loaded = await import("./config.json", { with: { type: "json" } }, 1)
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5218",
		},
		{
			name: "duplicate dynamic attribute",
			source: `export async function main(): Promise<string[]> {
  const loaded = await import("./config.json", { with: { type: "json", type: "text" } })
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5204",
		},
		{
			name: "invalid dynamic attribute name",
			source: `export async function main(): Promise<string[]> {
  const loaded = await import("./config.json", { with: { type: "json", "_mode": "const" } })
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5203",
		},
		{
			name: "nonliteral dynamic attribute value",
			source: `const kind = "json"
export async function main(): Promise<string[]> {
  const loaded = await import("./config.json", { with: { type: kind } })
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5205",
		},
		{
			name: "asset import without attributes",
			source: `export async function main(): Promise<string[]> {
  const loaded = await import("./config.json")
  return [loaded.default.mode]
}
`,
			want: "SMITHERS5201",
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			result := compileAssetProgram(t, testCase.source, asset)
			if codes := requireDiagnosticCodes(result); codes != testCase.want {
				t.Fatalf("diagnostics %s, want %s: %#v", codes, testCase.want, result.Diagnostics)
			}
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatalf("a refused dynamic asset edge must emit nothing: %v", artifactPaths(result.Artifacts))
			}
		})
	}
}

func TestPinnedForkOrdinaryDynamicCodeImportsRemainRuntimeEdges(t *testing.T) {
	code := SourceFile{
		Path: "code.ts", Kind: FileKindTypeScript,
		Text: "/** @module @throws {never} */\nexport const value = \"runtime-code\"\n",
	}
	literal := compileAssetProgram(t, `export async function main(): Promise<string[]> {
  const loaded = await import("./code.ts")
  return [loaded.value]
}
`, code)
	if literal.EmitSkipped || len(literal.Diagnostics) != 0 {
		t.Fatalf("ordinary literal dynamic code import must compile clean: %#v", literal.Diagnostics)
	}
	if got := runEmittedMain(t, literal); got != "runtime-code" {
		t.Fatalf("ordinary dynamic code import printed %q", got)
	}
	if emitted := mainText(t, literal); !strings.Contains(emitted, "import(") || !strings.Contains(emitted, "code") {
		t.Fatalf("ordinary dynamic code import was not retained as a runtime edge:\n%s", emitted)
	}

	computed := compileAssetProgram(t, `const chosen = "./code.ts"
export function load(): Promise<unknown> { return import(chosen) }
export function main(): string[] { return ["not loaded"] }
`, code)
	if computed.EmitSkipped || len(computed.Diagnostics) != 0 {
		t.Fatalf("a bare computed dynamic code import must remain available: %#v", computed.Diagnostics)
	}
	if got := runComptimeProgram(t, computed); got != "not loaded" {
		t.Fatalf("computed dynamic code control printed %q", got)
	}
	if emitted := mainText(t, computed); !strings.Contains(emitted, "import(") || !strings.Contains(emitted, "chosen") {
		t.Fatalf("bare computed dynamic import was rewritten or erased:\n%s", emitted)
	}
}

func TestPinnedForkJSONAssetEmbedding(t *testing.T) {
	const ordinary = `import counter from "./counter.json" with { type: "json" }
export function main(): string[] {
  const widened: number = counter.count
  counter.count = widened + 1
  return [` + "`" + `${counter.count},${counter.label.toUpperCase()}` + "`" + `]
}
`
	ordinaryResult := compileAssetProgram(t, ordinary, SourceFile{
		Path: "counter.json", Kind: FileKindAsset, Text: `{ "count": 3, "label": "widgets" }`,
	})
	if ordinaryResult.EmitSkipped || len(ordinaryResult.Diagnostics) != 0 {
		t.Fatalf("ordinary JSON asset must compile clean: %#v", ordinaryResult.Diagnostics)
	}
	if got := runComptimeProgram(t, ordinaryResult); got != "4,WIDGETS" {
		t.Fatalf("ordinary JSON runtime value = %q", got)
	}
	ordinaryJS := mainText(t, ordinaryResult)
	if strings.Contains(ordinaryJS, "counter.json") || strings.Contains(ordinaryJS, " with ") {
		t.Fatalf("the authored asset edge reached runtime output:\n%s", ordinaryJS)
	}

	const pinned = `import { native } from "smithers:native"
import config from "./config.json" with { type: "json", mode: "const" }
type Exactly<A, B> = (<G>() => G extends A ? 1 : 2) extends (<G>() => G extends B ? 1 : 2) ? true : false
const literalPreserving: Exactly<
  typeof config,
  { readonly mode: "production"; readonly ports: readonly [80, 443] }
> = true
function describe(): string { return ` + "`" + `${config.mode}/${config.ports.length}/${literalPreserving}` + "`" + ` }
native(describe)
export function main(): string[] { return [describe()] }
`
	asset := SourceFile{Path: "config.json", Kind: FileKindAsset, Text: `{ "mode": "production", "ports": [80, 443] }`}
	constResult := compileAssetProgram(t, pinned, asset)
	if constResult.EmitSkipped || len(constResult.Diagnostics) != 0 {
		t.Fatalf("const JSON native pin must compile with no SMITHERS3001: %#v", constResult.Diagnostics)
	}
	if got := runComptimeProgram(t, constResult); got != "production/2/true" {
		t.Fatalf("const JSON runtime value = %q", got)
	}
	constJS := mainText(t, constResult)
	if strings.Contains(constJS, "config.json") || !strings.Contains(constJS, "production") {
		t.Fatalf("const JSON was not embedded into the importing module:\n%s", constJS)
	}

	again := compileAssetProgram(t, pinned, asset)
	if again.EmitSkipped || len(again.Diagnostics) != 0 || mainText(t, again) != constJS {
		t.Fatal("identical const JSON input did not emit byte-for-byte identical JavaScript")
	}
}

func TestPinnedForkTextAssetEmbedding(t *testing.T) {
	const source = `import instructions from "./system.txt" with { type: "text" }
import markdownAsText from "./reviewer.md" with { type: "text" }
import yamlAsText from "./settings.yaml" with { type: "text" }
const other: typeof instructions = "a different string"
export function main(): string[] {
  return [instructions.trimEnd(), ` + "`" + `${markdownAsText.startsWith("---")}` + "`" + `, yamlAsText.trimEnd(), other]
}
`
	result := compileAssetProgram(t, source,
		SourceFile{Path: "system.txt", Kind: FileKindAsset, Text: "careful\n"},
		SourceFile{Path: "reviewer.md", Kind: FileKindAsset, Text: "---\ntitle: Reviewer\n---\n"},
		SourceFile{Path: "settings.yaml", Kind: FileKindAsset, Text: "retries: 2\n"},
	)
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("text assets must compile clean: %#v", result.Diagnostics)
	}
	if got := runComptimeProgram(t, result); got != "careful,true,retries: 2,a different string" {
		t.Fatalf("text runtime values = %q", got)
	}
	emitted := mainText(t, result)
	for _, specifier := range []string{"system.txt", "reviewer.md", "settings.yaml"} {
		if strings.Contains(emitted, specifier) {
			t.Fatalf("asset specifier %q reached runtime output:\n%s", specifier, emitted)
		}
	}
}

func TestPinnedForkBytesAssetEmbedding(t *testing.T) {
	const source = `import logo from "./logo.bin" with { type: "bytes" }
const typed: Uint8Array = logo
export function main(): string[] {
  return [` + "`" + `${logo.length}` + "`" + `, ` + "`" + `${logo[0]}` + "`" + `, ` + "`" + `${logo[1]}` + "`" + `, ` + "`" + `${typed instanceof Uint8Array}` + "`" + `]
}
`
	result := compileAssetProgram(t, source, SourceFile{
		Path: "logo.bin", Kind: FileKindAsset, Text: "SMITHERS\n",
	})
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("bytes asset must compile clean: %#v", result.Diagnostics)
	}
	if got := runComptimeProgram(t, result); got != "9,83,77,true" {
		t.Fatalf("bytes runtime value = %q", got)
	}
	emitted := mainText(t, result)
	if strings.Contains(emitted, "logo.bin") || !strings.Contains(emitted, "new Uint8Array") {
		t.Fatalf("bytes were not embedded as a typed array:\n%s", emitted)
	}
}

func TestPinnedForkMarkdownAssetEmbedding(t *testing.T) {
	const source = `import guide, { body, frontmatter, headings, source as raw } from "./reviewer.md" with { type: "markdown" }
export function main(): string[] {
  return [
    frontmatter.title,
    headings.map((heading) => ` + "`" + `${heading.level}:${heading.text}` + "`" + `).join(" | "),
    ` + "`" + `${guide === raw}` + "`" + `,
    guide.slice(headings[0].offset, headings[0].offset + 10),
    ` + "`" + `${body.trimStart().startsWith("# Reviewer")}` + "`" + `,
  ]
}
`
	const markdown = `---
title: Reviewer
audience: engineers
---

# Reviewer

Read the diff before answering.

` + "```" + `md
# Not a heading
` + "```" + `

## Checklist
`
	result := compileAssetProgram(t, source, SourceFile{
		Path: "reviewer.md", Kind: FileKindAsset, Text: markdown,
	})
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("Markdown asset must compile clean: %#v", result.Diagnostics)
	}
	if got := runComptimeProgram(t, result); got != "Reviewer,1:Reviewer | 2:Checklist,true,# Reviewer,true" {
		t.Fatalf("Markdown runtime value = %q", got)
	}
	emitted := mainText(t, result)
	if strings.Contains(emitted, "reviewer.md") || !strings.Contains(emitted, "# Reviewer") {
		t.Fatalf("Markdown source and metadata were not embedded:\n%s", emitted)
	}
}

func TestPinnedForkMdxAssetEmbedding(t *testing.T) {
	const source = `import Prompt, { components, expressions, frontmatter, tree } from "./coding-agent.mdx" with { type: "mdx" }
export function main(): string[] {
  return [
    frontmatter.title,
    components.join(","),
    expressions.join(","),
    ` + "`" + `${Prompt === tree}` + "`" + `,
    tree[3].kind === "element" ? tree[3].props.tone : "missing",
  ]
}
`
	const mdx = `---
title: Coding Agent
---

<System>Answer carefully.</System>

<Instructions tone="direct">Review {target} and report the risk.</Instructions>
`
	result := compileAssetProgram(t, source, SourceFile{
		Path: "coding-agent.mdx", Kind: FileKindAsset, Text: mdx,
	})
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("MDX asset must compile clean: %#v", result.Diagnostics)
	}
	if got := runComptimeProgram(t, result); got != "Coding Agent,System,Instructions,target,true,direct" {
		t.Fatalf("MDX runtime value = %q", got)
	}
	emitted := mainText(t, result)
	if strings.Contains(emitted, "coding-agent.mdx") || strings.Contains(emitted, "{target}") ||
		!strings.Contains(emitted, `"placeholder": "target"`) {
		t.Fatalf("MDX did not emit a pure-data placeholder tree:\n%s", emitted)
	}
}

func TestPinnedForkAssetLoadersFailClosed(t *testing.T) {
	tests := []struct {
		name   string
		source string
		asset  SourceFile
	}{
		{
			name: "invalid JSON",
			source: `import value from "./value.json" with { type: "json" }
export function main(): string[] { return [String(value)] }
`,
			asset: SourceFile{Path: "value.json", Kind: FileKindAsset, Text: `{"open": true`},
		},
		{
			name: "invalid JSON mode",
			source: `import value from "./value.json" with { type: "json", mode: "mutable" }
export function main(): string[] { return [String(value)] }
`,
			asset: SourceFile{Path: "value.json", Kind: FileKindAsset, Text: `{"open": true}`},
		},
		{
			name: "ambiguous Markdown frontmatter",
			source: `import value from "./value.md" with { type: "markdown" }
export function main(): string[] { return [value] }
`,
			asset: SourceFile{Path: "value.md", Kind: FileKindAsset, Text: "---\nflag: yes\n---\n# Value\n"},
		},
		{
			name: "executable MDX expression",
			source: `import value from "./value.mdx" with { type: "mdx" }
export function main(): string[] { return [String(value.length)] }
`,
			asset: SourceFile{Path: "value.mdx", Kind: FileKindAsset, Text: "<System>{target()}</System>\n"},
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			result := compileAssetProgram(t, testCase.source, testCase.asset)
			if codes := requireDiagnosticCodes(result); codes != "SMITHERS5213" {
				t.Fatalf("diagnostics %s, want SMITHERS5213: %#v", codes, result.Diagnostics)
			}
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatalf("a refused loader must emit nothing: %v", artifactPaths(result.Artifacts))
			}
		})
	}
}

func TestPinnedForkMarkdownOffsetsUseUTF16(t *testing.T) {
	const source = `import guide, { headings } from "./unicode.md" with { type: "markdown" }
export function main(): string[] {
  return [guide.slice(headings[0].offset, headings[0].offset + 8), ` + "`" + `${headings[0].offset}` + "`" + `]
}
`
	result := compileAssetProgram(t, source, SourceFile{
		Path: "unicode.md", Kind: FileKindAsset, Text: "😀\n# Review\n",
	})
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("Unicode Markdown must compile clean: %#v", result.Diagnostics)
	}
	if got := runComptimeProgram(t, result); got != "# Review,3" {
		t.Fatalf("Markdown UTF-16 offset observation = %q", got)
	}
}

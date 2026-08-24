package compiler

import (
	"strings"
	"testing"
	"unicode/utf16"
)

// TestPinnedForkDiagnosticSpansUseUTF16 proves the wire contract with all
// three Unicode shapes that commonly expose an incorrect offset conversion:
// a BMP non-ASCII code point, an astral surrogate pair, and a combining
// sequence. They all precede the diagnostic in one authored fixture.
func TestPinnedForkDiagnosticSpansUseUTF16(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := "const fidelity = \"—😀e\u0301\"\nexport const home = process.env.HOME\n"
	files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     files,
		Options:   Options{},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	var diagnostic *Diagnostic
	for index := range result.Diagnostics {
		if result.Diagnostics[index].Code == "SMITHERS1601" {
			diagnostic = &result.Diagnostics[index]
			break
		}
	}
	if diagnostic == nil || diagnostic.Span == nil {
		t.Fatalf("missing source-located SMITHERS1601: %#v", result.Diagnostics)
	}
	byteStart := strings.Index(source, "process")
	wantStart := len(utf16.Encode([]rune(source[:byteStart])))
	// — contributes two excess UTF-8 bytes, 😀 contributes two, and the
	// combining mark contributes one. This guards against a fix tailored to
	// only one multibyte width.
	if byteStart-wantStart != 5 {
		t.Fatalf("fixture does not exercise all three Unicode classes: byte=%d UTF16=%d", byteStart, wantStart)
	}
	if diagnostic.Span.Start != wantStart || diagnostic.Span.Length != len("process") {
		t.Fatalf("diagnostic span = %#v, want UTF-16 start %d length %d", diagnostic.Span, wantStart, len("process"))
	}
	if got := strings.Join(formatDiagnosticPositions(t, files, result), " "); got != "SMITHERS1601@2:21" {
		t.Fatalf("authored diagnostic position = %s, want SMITHERS1601@2:21", got)
	}
}

// TestPinnedForkTopLevelCheckedChannelsFailClosed audits the complete
// Panic-charging call family at module evaluation. Result unwrap,
// throw and requirements have separate focused tests; these
// rows cover the previously missing expect, explicit panic, and foreign-call
// paths together with symbol-identity negatives.
func TestPinnedForkTopLevelCheckedChannelsFailClosed(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "Result.expect has no module-level Panic channel",
			source: `function parse(text: string): Result<number, RangeError> {
  const value = Number(text)
  if (Number.isNaN(value)) throw new RangeError(text)
  return value
}

const first = parse("7").expect("the literal is a number")

export function main(): string[] { return [String(first)] }
`,
			reject: []string{"SMITHERS1505@7:15"},
		},
		{
			name: "both compiler-owned panic spellings have no module-level channel",
			source: `import { panic as fail } from "smithers:exceptions"
fail("first")
Reflect.panic("second")
export function main(): string[] { return [] }
`,
			reject: []string{"SMITHERS1505@2:1", "SMITHERS1505@3:1"},
		},
		{
			name: "declared and default foreign failures need a module-level channel",
			source: `import { trusted, declared, untrusted } from "./foreign"
const a = trusted()
const b = declared()
const c = untrusted()
export function main(): string[] { return [String(a), String(b), String(c)] }
`,
			support: `/**
 * @module
 * @throws {never}
 */
/** @throws {never} */
export function trusted(): number { return 1 }
/** @throws {RangeError} */
export function declared(): number { return 2 }
export function untrusted(): number { return 3 }
`,
			reject: []string{"SMITHERS1505@3:11", "SMITHERS1505@4:11"},
		},
		{
			name: "unrelated expect and panic spellings stay ordinary",
			source: `const local = { expect: () => "ordinary" }
function panic(): string { return "local" }
const first = local.expect()
const second = panic()
export function main(): string[] { return [first, second] }
`,
			stdout: "ordinary\nlocal",
		},
	})
}

// TestPinnedForkSpecDerivedDiagnosticSituations closes the three census rows
// structurally. Each has a nearby acceptance case that a TS-code translator or
// name-spelling matcher cannot handle soundly.
func TestPinnedForkSpecDerivedDiagnosticSituations(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "with as a property name is ordinary TypeScript syntax",
			source: `const scope = { with: "ordinary" }
export function main(): string[] { return [scope.with] }
`,
			stdout: "ordinary",
		},
		{
			name: "an unresolved lookalike package has no intrinsic trust",
			source: `import { helper } from "smithersutils"

export function main(): string[] {
  return [typeof helper === "function" ? "present" : "absent"]
}
`,
			reject: []string{"SMITHERS1510@1:24"},
		},
		{
			name: "a missing exported binding fails the checked module closure",
			source: `import { absent } from "./helper.sm"
export function main(): string[] { return [typeof absent] }
`,
			modules: []string{"helper.sm\x00" + `export function present(value: number): number { return value + 1 }
`},
			reject: []string{"SMITHERS1804@1:10"},
		},
		{
			name: "a renamed real export is resolved by identity rather than local spelling",
			source: `import { present as absent } from "./helper.sm"
export function main(): string[] { return [String(absent(41))] }
`,
			modules: []string{"helper.sm\x00" + `export function present(value: number): number { return value + 1 }
`},
			stdout: "42",
		},
	})
}

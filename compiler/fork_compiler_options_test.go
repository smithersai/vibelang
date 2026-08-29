package compiler

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The two backends must answer one question the same way, so the two tables
// that answer it are compared as text rather than trusted to stay aligned by
// review. compatibility.mdx §Mandatory and §Forbidden are normative lists; a
// backend that dropped a member would accept a project the other rejects, which
// is a per-backend dialect the decision ledger warns against by name.
//
// The register recorded that "none of the eleven forbidden options is rejected".
// That was wrong for this backend and had been for as long as the bridge has had
// a `default:` arm over its options map: `experimentalDecorators` WAS refused
// here, as a bare `fmt.Errorf("unsupported compiler option %q", name)` in the
// envelope's Error field with no code, no file and no span. The allowlist is
// kept and the classification is what was added.
func TestForkAndReferenceOptionTablesAgree(t *testing.T) {
	reference, err := os.ReadFile(filepath.Join("..", "poc", "src", "language", "compiler-options.ts"))
	if err != nil {
		t.Fatal(err)
	}
	bridge, err := os.ReadFile(filepath.Join("forkbridge", "main.go.txt"))
	if err != nil {
		t.Fatal(err)
	}

	for _, table := range []struct {
		name          string
		referenceName string
		bridgeName    string
	}{
		{"mandatory", "MANDATORY_COMPILER_OPTIONS", "smithersMandatoryOptions"},
		{"forbidden", "FORBIDDEN_COMPILER_OPTIONS", "smithersForbiddenOptions"},
		{"permitted", "PERMITTED_COMPILER_OPTIONS", "smithersPermittedOptions"},
	} {
		t.Run(table.name, func(t *testing.T) {
			want := listBetween(t, string(reference),
				table.referenceName+": readonly string[] = [", "\n];")
			got := listBetween(t, string(bridge),
				table.bridgeName+" = []string{", "\n}")
			if strings.Join(want, ",") != strings.Join(got, ",") {
				t.Fatalf("%s table drifted between backends.\n  reference (%s): %v\n  fork      (%s): %v",
					table.name, table.referenceName, want, table.bridgeName, got)
			}
			if len(want) == 0 {
				t.Fatalf("%s table read as empty; the extraction is wrong, not the tables", table.name)
			}
		})
	}
}

var quotedName = regexp.MustCompile(`"([A-Za-z]+)"`)

// listBetween reads the quoted names of one table literal. Both languages spell
// a list of string literals the same way, so one extractor serves both and
// neither table can be "compared" against a pattern that never matched.
func listBetween(t *testing.T, text string, open string, close string) []string {
	t.Helper()
	start := strings.Index(text, open)
	if start < 0 {
		t.Fatalf("could not find %q", open)
	}
	rest := text[start+len(open):]
	end := strings.Index(rest, close)
	if end < 0 {
		t.Fatalf("could not find the end of %q", open)
	}
	names := make([]string, 0)
	for _, match := range quotedName.FindAllStringSubmatch(rest[:end], -1) {
		names = append(names, match[1])
	}
	return names
}

// The mandatory options are DEFAULTS on this backend, not caller preferences:
// §Configuration forbids them to vary by host. Before this, `strict` was the
// only one set and it was caller-defeasible — `strict: false` was honored.
func TestForkRejectsAWeakenedMandatoryOption(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: "export function main(): string { return \"ok\" }\n"}},
		Options:   Options{"strict": false},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, result, "SMITHERS6001", "strict")
}

// §Forbidden: "Options that upstream has deprecated or removed ... MUST be
// rejected rather than ignored." Rejected WITH A CODE is the part that is new.
func TestForkRejectsForbiddenAndUnknownOptions(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		option string
		code   string
	}{
		{"experimentalDecorators", "SMITHERS6002"},
		{"emitDecoratorMetadata", "SMITHERS6002"},
		{"keyofStringsOnly", "SMITHERS6002"},
		{"importsNotUsedAsValues", "SMITHERS6002"},
		{"notAnOptionAtAll", "SMITHERS6003"},
	} {
		t.Run(probe.option, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.sm"},
				Files:     []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: "export function main(): string { return \"ok\" }\n"}},
				Options:   Options{probe.option: true},
				Lowering:  LoweringInternal,
			})
			if err != nil {
				t.Fatal(err)
			}
			requireCode(t, result, probe.code, probe.option)
		})
	}
}

// The span is the point of carrying the configuration as TEXT. A rejection with
// no position cannot tell the author which line to delete, which is what the
// previous bare error string could not do on either backend.
func TestForkReportsConfigurationFindingsWithASpan(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	config := `{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "useDefineForClassFields": true,
    "experimentalDecorators": true
  }
}
`
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames:  []string{"main.sm"},
		Files:      []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: "export function main(): string { return \"ok\" }\n"}},
		Options:    Options{},
		Lowering:   LoweringInternal,
		ConfigFile: &ConfigFile{Path: "/project/tsconfig.json", Text: config},
	})
	if err != nil {
		t.Fatal(err)
	}
	found := requireCode(t, result, "SMITHERS6002", "experimentalDecorators")
	if found.File != "/project/tsconfig.json" {
		t.Fatalf("file = %q, want the tsconfig", found.File)
	}
	if found.Span == nil {
		t.Fatal("a configuration finding must carry a span")
	}
	quoted := config[found.Span.Start : found.Span.Start+found.Span.Length]
	if quoted != `"experimentalDecorators"` {
		t.Fatalf("span covers %q, want the option name the author wrote", quoted)
	}
}

func TestForkAcceptsAConformingConfiguration(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	config := `{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "useDefineForClassFields": true,
    "target": "ES2022"
  }
}
`
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames:  []string{"main.sm"},
		Files:      []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: "export function main(): string { return \"ok\" }\n"}},
		Options:    Options{},
		Lowering:   LoweringInternal,
		ConfigFile: &ConfigFile{Path: "/project/tsconfig.json", Text: config},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Diagnostics {
		if strings.HasPrefix(item.Code, "SMITHERS6") {
			t.Fatalf("a conforming configuration reported %s: %s", item.Code, item.Message)
		}
	}
}

// The same four containers the reference's compiler-options.test.ts measures.
// `!` is the error axis and `?.`/`??` are the absence axis, so an author-written
// `Result<A, E> | undefined` is still not a `!` operand — only the widening
// `noUncheckedIndexedAccess` adds at the ACCESS site is seen through.
func TestForkPostfixBangOnAWidenedIndexRead(t *testing.T) {
	const head = `export class Missing extends Error {
  constructor(readonly key: string) { super(key) }
}

function lookup(key: string): Result<string, Missing> {
  if (key !== "ada") throw new Missing(key)
  return "Ada Lovelace"
}
`
	for _, probe := range []struct {
		name   string
		body   string
		reject string
	}{
		{
			name: "a Result array compiles",
			body: `export function main(i: number): Result<string, Missing> {
  const found: Result<string, Missing>[] = [lookup("ada")]
  return found[i]!
}
`,
		},
		{
			name: "an unbound returned Result collection compiles",
			body: `function pack(): readonly Result<string, Missing>[] { return [lookup("ada")] }
export function main(): Result<string, Missing> {
  return pack()[0]!
}
`,
		},
		{
			name: "an array whose element type is itself optional is refused",
			body: `export function main(i: number): Result<string, Missing> {
  const found: (Result<string, Missing> | undefined)[] = [lookup("ada")]
  return found[i]!
}
`,
			reject: "SMITHERS1207",
		},
		{
			name: "a non-Result array is refused",
			body: `export function main(i: number): Result<string, Missing> {
  const names: string[] = ["ada"]
  const n = names[i]!
  return n
}
`,
			reject: "SMITHERS1207",
		},
		{
			name: "a plain optional binding is still refused",
			body: `export function main(): Result<string, Missing> {
  const maybe: string | undefined = "Ada"
  const name = maybe!
  return name
}
`,
			reject: "SMITHERS1207",
		},
	} {
		t.Run(probe.name, func(t *testing.T) {
			files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: head + probe.body}}
			result := compileInternalSource(t, files)
			codes := make([]string, 0)
			for _, item := range result.Diagnostics {
				if item.Category == DiagnosticError {
					codes = append(codes, item.Code)
				}
			}
			joined := strings.Join(codes, " ")
			if probe.reject == "" {
				if len(codes) != 0 {
					t.Fatalf("expected a clean compile, got %s", joined)
				}
				return
			}
			if !strings.Contains(joined, probe.reject) {
				t.Fatalf("expected %s, got %q", probe.reject, joined)
			}
		})
	}
}

func requireCode(t *testing.T, result CompileResult, code string, mentions string) Diagnostic {
	t.Helper()
	for _, item := range result.Diagnostics {
		if item.Code == code && strings.Contains(item.Message, mentions) {
			return item
		}
	}
	t.Fatalf("no %s naming %q; diagnostics %#v", code, mentions, result.Diagnostics)
	return Diagnostic{}
}

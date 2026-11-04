package vibelangfuzz

import (
	"fmt"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const errorMemberFixKey = "key:error-member-fix\n"

func TestErrorMemberFixQuoted(t *testing.T) {
	const importQuote = "Declaration import spelling follows TypeScript's source and tsconfig rules"
	if !strings.Contains(SpecText("007-tooling.md"), importQuote) {
		t.Fatalf("Chapter 7 no longer says %q", importQuote)
	}
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
}

// Native class expansion must retain the original factory's observable
// matcher, constructor, tag and fields. FuzzFix supplies the shared Exit and
// declaration oracles; this generator only supplies the old source shapes.
func errorMemberFixArchive(input string) string {
	data := []byte(strings.TrimPrefix(input, errorMemberFixKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	name := []string{"Busy", "SmithersError", "AdapterError"}[int(pick(0))%3]
	n := int(pick(1)) - 128
	var declaration, construct string
	switch pick(2) % 5 {
	case 0:
		declaration = fmt.Sprintf("export error %s { code: string; static readonly count = %d }", name, n)
		construct = fmt.Sprintf("new %s({code: %q})", name, fmt.Sprint(n))
	case 1:
		declaration = fmt.Sprintf("export error %s { code: string; constructor(code: string) { super({code: code.trim()}) } }", name)
		construct = fmt.Sprintf("new %s(%q)", name, " "+fmt.Sprint(n)+" ")
	case 2:
		declaration = fmt.Sprintf("export error %s<T> { code: T }", name)
		construct = fmt.Sprintf("new %s<string>({code: %q})", name, fmt.Sprint(n))
	case 3:
		declaration = fmt.Sprintf("export abstract error %s { code: string }\nexport class Concrete extends %s {}", name, name)
		construct = fmt.Sprintf("new Concrete({code: %q})", fmt.Sprint(n))
		if pick(4)&1 != 0 {
			declaration = fmt.Sprintf("export abstract error %s\nexport class Concrete extends %s { readonly code = %q }", name, name, fmt.Sprint(n))
			construct = "new Concrete()"
		}
	}
	if pick(2)%5 == 4 {
		declaration = fmt.Sprintf(`import * as S from "effect/Schema"
import { $schemaErrorMember as registerMember } from "vibelang-runtime"
export abstract schema error %s { code: string }
export class Concrete extends %s.extend<Concrete>("Concrete")({ _tag: S.tag("Concrete"), count: S.Number }) {
 static { registerMember(this) }
}`, name, name)
		construct = fmt.Sprintf("new Concrete({code: %q, count: %d})", fmt.Sprint(n), n)
	}
	shadow := ""
	if pick(3)&1 != 0 {
		shadow = "const TaggedError = 0; const Data = 1; const $LegacyTaggedError = 2; const $ErrorTaggedError = 3;\n"
	}
	if pick(2)%5 == 4 && pick(3)&1 != 0 {
		shadow += "const Schema = 0; const $LegacySchemaErrorFamily = 1; const $ErrorSchemaFamily = 2;\n"
	}
	source := fmt.Sprintf(`import { customMatcher } from "vibelang-runtime"
%s%s
export effect function main() {
 const error = %s
 const constructor = error.constructor as unknown as { readonly [key: symbol]: unknown }
 const matcher = constructor[customMatcher] as undefined | ((subject: unknown, hint?: {matchType: "extractor"}) => unknown)
 const observed = typeof matcher === "function" ? try Effect.try(() => {
  const extracted = matcher.call(%s, error, {matchType:"extractor"}) as readonly {code:string}[]
  return {own:matcher.call(%s,error),cross:matcher.call(%s,{_tag:"%s",code:"copy"}),other:matcher.call(%s,{_tag:"Other"}),extracted:extracted[0].code}
 }) : null
 return {observed,tag:error._tag,code:error.code,name:error.name,instance:error instanceof %s,matcher:typeof constructor[customMatcher]}
}
`, shadow, declaration, construct, name, name, name, name, name, name)
	if pick(2)%5 == 4 {
		additional := fmt.Sprintf(` const decoded = try Effect.try(() => S.decodeUnknownSync(%s)({_tag:"Concrete", code:"copy", count:%d}))
 const encoded = try Effect.try(() => S.encodeSync(%s)(error))
`, name, n, name)
		source = strings.Replace(source, " return {observed,", additional+" return {decoded:decoded instanceof Concrete,encoded,observed,", 1)
	}
	return Archive(map[string]string{"main.vibe": source})
}

// These precise retirement diagnostics did not stop the old JavaScript from
// emitting. Exercise that emit, requiring a migration diagnostic and refusing
// every unrelated error rather than turning off the existing runtime oracle.
func errorMemberFixRunnable(r *Result) bool {
	if r.EmitSkipped {
		return false
	}
	found := false
	for _, d := range r.Diagnostics {
		if IsEK(d) && d.Code() == 1308 {
			found = true
			continue
		}
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if !IsEK(d) || (d.Code() != 1301 && d.Code() != 1302 && d.Code() != 1303) {
			return false
		}
		found = true
	}
	return found
}

// Importing a fresh namespace to avoid capture only renames qualified type
// references. Canonicalize that lexical alias, retaining every other token;
// FuzzFix also checks actual contract assignability in both directions.
func errorMigrationDeclaration(text string) string {
	imports := regexp.MustCompile(`(?m)^import \* as ([A-Za-z_$][A-Za-z0-9_$]*) from "effect/Schema";\r?\n`)
	for _, match := range imports.FindAllStringSubmatch(text, -1) {
		text = strings.ReplaceAll(text, match[0], "")
		text = strings.ReplaceAll(text, match[1]+".", `import("effect/Schema").`)
	}
	return text
}

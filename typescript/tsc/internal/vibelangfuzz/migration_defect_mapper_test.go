package vibelangfuzz

import (
	"strings"
	"testing"
)

const migrationDefectMapperQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

var migrationDefectMapperPrograms = []struct{ key, source string }{
	{"alchemy-success", "import { isResolved, havePropsChanged, makeNews } from \"./contract.js\"\nexport const main = () => Effect.gen(function* () { const news = makeNews(0); if (!isResolved(news)) return undefined; return havePropsChanged({}, news) ? \"update\" : \"noop\" })\n"},
	{"alchemy-getter", "import { isResolved, havePropsChanged, makeNews } from \"./contract.js\"\nexport const main = () => Effect.gen(function* () { const news = makeNews(1); if (!isResolved(news)) return undefined; return havePropsChanged({}, news) ? \"update\" : \"noop\" })\n"},
	{"alchemy-bigint", "import { isResolved, havePropsChanged, makeNews } from \"./contract.js\"\nexport const main = () => Effect.gen(function* () { const news = makeNews(2); if (!isResolved(news)) return undefined; return havePropsChanged({}, news) ? \"update\" : \"noop\" })\n"},
	{"smithers-glob", "import * as Contract from \"./contract.js\"\nexport const main = () => Effect.gen(function* () { return Contract.validateGlob(\"valid\") ?? \"ok\" })\n"},
	{"plain-good", "export const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"plain-bad", "export const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"top-shadow-good", "const identity = \"shadow\"; void identity\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"top-shadow-bad", "const identity = \"shadow\"; void identity\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"inner-shadow-good", "export const main = () => Effect.gen(function* () {\nconst identity = \"shadow\"; void identity\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"inner-shadow-bad", "export const main = () => Effect.gen(function* () {\nconst identity = \"shadow\"; void identity\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"existing-alias-good", "import { identity as preserve } from \"effect/Function\"\nvoid preserve\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"existing-alias-bad", "import { identity as preserve } from \"effect/Function\"\nvoid preserve\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"namespace-shadow-good", "const Function = { identity: \"shadow\" }; void Function\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"namespace-shadow-bad", "const Function = { identity: \"shadow\" }; void Function\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"occupied-names-good", "const identity = 1, identity2 = 2; void [identity, identity2]\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"occupied-names-bad", "const identity = 1, identity2 = 2; void [identity, identity2]\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"escaped-shadow-good", "const \\u0069dentity = \"shadow\"; void \\u0069dentity\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"escaped-shadow-bad", "const \\u0069dentity = \"shadow\"; void \\u0069dentity\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
}

func TestMigrationDefectMapperQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDefectMapperQuote) {
		t.Fatalf("Chapter 7 no longer contains %q", migrationDefectMapperQuote)
	}
}

package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const stockDeclarationAPIQuote = "the same exported names, each export's type identical to "

func TestDeclarationIdentityStockAPIQuoted(t *testing.T) {
	quote := stockDeclarationAPIQuote + string(rune(96)) + "tsc" + string(rune(96)) + "'s in both directions (a type-level check)"
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatal(quote)
	}
}

// Source suppressions can leave an erroneous exported declaration. Only owned
// namespace-as-type TS2709 makes this baseline ineligible. Missing dependencies
// and other failures remain failures, not missing-environment/pending waivers.
func declarationIdentitySuppressedStockAPI(ctx context.Context, api, dir string, stock Project) (string, error) {
	suppressed := false
	for name, text := range stock.Files {
		if isTypeScript(name) && !isDeclaration(name) && (strings.Contains(text, "@ts-expect-error") || strings.Contains(text, "@ts-ignore")) {
			suppressed = true
			break
		}
	}
	if !suppressed {
		return "", nil
	}
	const script = `import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { join } from "node:path";
const [api, root] = process.argv.slice(1), ts = createRequire(import.meta.url)(api);
const config = ts.readConfigFile(join(root,"tsconfig.json"), ts.sys.readFile);
if(config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,"\\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
if(parsed.errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>root,getNewLine:()=>"\\n"}));
const roots = [];
function visit(dir) {
 for(const entry of readdirSync(dir,{withFileTypes:true})) {
  const file=join(dir,entry.name);
  if(entry.isDirectory()) visit(file);
  else if(/\.d\.[cm]?ts$/.test(entry.name)) roots.push(file);
 }
}
visit(join(root,"__identity_out")); roots.sort();
if(!roots.length) throw Error("stock emitted no declaration roots");
const program = ts.createProgram(roots,{...parsed.options,noEmit:true,skipLibCheck:false});
const errors = roots.flatMap(file => {
 const source=program.getSourceFile(file);
 if(!source) throw Error("stock declaration root was not loaded: "+file);
 return [...program.getSyntacticDiagnostics(source),...program.getSemanticDiagnostics(source)];
}).filter(d=>d.category===ts.DiagnosticCategory.Error);
console.log(JSON.stringify(errors.map(d=>({code:d.code,file:d.file?.fileName,text:ts.flattenDiagnosticMessageText(d.messageText,"\\n")}))));`
	cmd := exec.CommandContext(ctx, "node", "--input-type=module", "-e", script, api, dir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("stock declaration API preflight failed: %w: %.1200s", err, out)
	}
	var records []struct {
		Code       int
		File, Text string
	}
	if err := json.Unmarshal(out, &records); err != nil {
		return "", fmt.Errorf("stock declaration API preflight result: %w: %.1200s", err, out)
	}
	if len(records) == 0 {
		return "", nil
	}
	root := filepath.Join(dir, "__identity_out") + string(os.PathSeparator)
	for _, record := range records {
		if record.Code != 2709 || !strings.HasPrefix(record.File, root) {
			return "", fmt.Errorf("stock declaration API unavailable (not a namespace-type eligibility case): TS%d: %s", record.Code, record.Text)
		}
	}
	return "stock emitted declaration has no namespace-type API: suppressed source exports TS2709", nil
}

func TestDeclarationIdentitySuppressedBaseline(t *testing.T) {
	TestDeclarationIdentityStockAPIQuoted(t)
	skipped := false
	passed := t.Run("owned-suppressed-namespace", func(t *testing.T) {
		t.Cleanup(func() { skipped = t.Skipped() })
		source := "import * as Effect from \"effect/Effect\"\n// @ts-expect-error A namespace is not a global type alias.\nexport type NotGlobal=Effect<number>\nexport type Canonical=Effect.Effect<number>\n"
		CheckDeclarationIdentity(t, NewWorkspace(t), StockTypeScript(t), declarationIdentityAPI(t), Archive(map[string]string{"main.ts": source}))
	})
	if !passed || !skipped {
		t.Fatal("a source suppression did not exclude its invalid emitted namespace API")
	}
}

func TestDeclarationIdentitySuppressionAPIControls(t *testing.T) {
	w := NewWorkspace(t)
	api, tsc := declarationIdentityAPI(t), StockTypeScript(t)
	for name, row := range map[string]struct {
		source      string
		unavailable bool
	}{
		"canonical":             {"import * as Effect from \"effect/Effect\"\nexport type Canonical=Effect.Effect<number>\n", false},
		"unexported-error":      {"import * as Effect from \"effect/Effect\"\n// @ts-expect-error Local namespace misuse does not escape the API.\ntype Local=Effect<number>\nexport type Canonical=Effect.Effect<number>\n", false},
		"unrelated-suppression": {"// @ts-expect-error Intentional local assignment failure.\nconst local:string=1\nexport const value=1\n", false},
		"unresolved-export":     {"// @ts-ignore Deliberately unresolved, never a namespace-type eligibility waiver.\nexport type Missing=import(\"pmfix-stock-api-missing-package\").Missing\n", true},
	} {
		t.Run(name, func(t *testing.T) {
			stock, _, why := declarationIdentityProjects(Archive(map[string]string{"main.ts": row.source}))
			if why != "" {
				t.Fatal(why)
			}
			dir := emitDeclarationIdentityStock(t, w, tsc, stock)
			defer os.RemoveAll(dir)
			before, err := os.ReadFile(filepath.Join(dir, "__identity_out/main.d.ts"))
			if err != nil {
				t.Fatal(err)
			}
			reason, err := declarationIdentitySuppressedStockAPI(t.Context(), api, dir, stock)
			if row.unavailable {
				if err == nil || !strings.Contains(err.Error(), "TS2307") {
					t.Fatalf("missing dependencies must remain explicit failures: %q %v", reason, err)
				}
			} else if err != nil || reason != "" {
				t.Fatalf("valid exported API was rejected: %q %v", reason, err)
			}
			after, err := os.ReadFile(filepath.Join(dir, "__identity_out/main.d.ts"))
			if err != nil {
				t.Fatal(err)
			}
			if string(before) != string(after) {
				t.Fatal("preflight changed the emitted declaration")
			}
		})
	}
}

func FuzzStockSuppressedNamespaceAPI(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"exported", "local", "unresolved", "erased-import", "valid"} {
		f.Add(key, "Effect", "number")
		f.Add(key, "Fx", "string")
	}
	w := NewWorkspace(f)
	api, tsc := declarationIdentityAPI(f), StockTypeScript(f)
	f.Fuzz(func(t *testing.T, key, alias, argument string) {
		TestDeclarationIdentityStockAPIQuoted(t)
		switch key {
		case "exported", "local", "unresolved", "erased-import", "valid":
		default:
			key = "exported"
		}
		if alias != "Fx" && alias != "Effect" && alias != "Eff" {
			alias = "Effect"
		}
		switch argument {
		case "number", "string", "boolean":
		default:
			argument = "number"
		}
		source := "import * as " + alias + " from \"effect/Effect\"\n"
		switch key {
		case "exported":
			source += "// @ts-expect-error A namespace is not a type.\nexport type Wrong=" + alias + "<" + argument + ">\n"
			source += "export type Canonical=" + alias + ".Effect<" + argument + ">\n"
		case "erased-import":
			source += "// @ts-expect-error This unresolved export must not be waived.\nexport type Wrong=" + alias + "<" + argument + ">\n"
		case "local":
			source += "// @ts-expect-error This local misuse does not escape the API.\ntype Local=" + alias + "<" + argument + ">\nexport type Public=" + alias + ".Effect<" + argument + ">\n"
		case "unresolved":
			source += "// @ts-ignore An unresolved export must never be waived.\nexport type Missing=import(\"pmfix-stock-api-missing-package\").Missing\n"
		case "valid":
			source += "export type Public=" + alias + ".Effect<" + argument + ">\n"
		}
		stock, _, why := declarationIdentityProjects(Archive(map[string]string{"main.ts": source}))
		if why != "" {
			t.Fatal(why)
		}
		dir := emitDeclarationIdentityStock(t, w, tsc, stock)
		defer os.RemoveAll(dir)
		reason, err := declarationIdentitySuppressedStockAPI(t.Context(), api, dir, stock)
		switch key {
		case "exported":
			if err != nil || reason == "" {
				t.Fatalf("exported erroneous namespace has no API: %q %v", reason, err)
			}
		case "erased-import":
			if err == nil || !strings.Contains(err.Error(), "TS2304") {
				t.Fatalf("an erased import must remain an explicit failure: %q %v", reason, err)
			}
		case "unresolved":
			if err == nil || !strings.Contains(err.Error(), "TS2307") {
				t.Fatalf("missing dependency was waived: %q %v", reason, err)
			}
		default:
			if err != nil || reason != "" {
				t.Fatalf("valid exported API was rejected: %q %v", reason, err)
			}
		}
	})
}

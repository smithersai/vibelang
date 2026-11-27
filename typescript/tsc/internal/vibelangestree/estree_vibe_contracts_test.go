package vibelangestree

import "testing"

func TestParseErrorDeclarationProducesValidRanges(t *testing.T) {
	src := "export error UserNotFound { id: string }\n"
	program := parse(t, "/a.vibe", src)
	if program["type"] != "Program" {
		t.Fatalf("expected Program root, got %v", program["type"])
	}
	start, end := rangeOf(program)
	if start != 0 || end > len(src) {
		t.Fatalf("unexpected Program range [%d, %d] for len %d", start, end, len(src))
	}
}

func TestParseServiceDeclarationWithTypedErrorSlot(t *testing.T) {
	src := "error Gone\nservice Users { find(id: string): string!Gone }\n"
	program := parse(t, "/service.vibe", src)
	all := nodes(program)
	if len(all) < 5 {
		t.Fatalf("expected structured ESTree nodes for service declaration, got %d", len(all))
	}
}

func TestParseEffectFunctionWithTryAndCatch(t *testing.T) {
	src := "export effect function load(id: string) {\n  const x = try fetchUser(id) catch () => \"guest\"\n  return x\n}\n"
	program := parse(t, "/effect.vibe", src)
	all := nodes(program)
	if len(all) < 8 {
		t.Fatalf("expected structured ESTree nodes for effect function, got %d", len(all))
	}
}

func TestParseProvideBlockAndConcurrentAll(t *testing.T) {
	src := "export effect function main() {\n  provide UsersLive {\n    const [a, b] = try.all [first(), second()]\n    return [a, b]\n  }\n}\n"
	program := parse(t, "/provide.vibe", src)
	all := nodes(program)
	if len(all) < 10 {
		t.Fatalf("expected structured ESTree nodes for provide + try.all, got %d", len(all))
	}
}

func TestParseVibeDirectiveInsideTypeScriptFile(t *testing.T) {
	src := "// @vibe\nexport effect function greet(name: string) {\n  return name\n}\n"
	program := parse(t, "/directive.ts", src)
	if program["type"] != "Program" {
		t.Fatalf("expected Program root for // @vibe .ts file, got %v", program["type"])
	}
}

package vibelang

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// materializeLegacyEmptyPackageKeys reads an explicitly requested legacy source
// under its former directory-prefixed service identities. Write those literals
// before taking the fix baseline, so subsequent rewrites preserve both the
// runtime key and its declaration type. The explicit key option keeps written
// readonlyness; modern --fix keeps the current derived
// identity. Existing explicit keys and foreign sources remain untouched.
func materializeLegacyEmptyPackageKeys(ctx context.Context, program *compiler.Program, scope *fixScope, texts map[tspath.RootedFilePath]string, result *FixResult) bool {
	changed := false
	for _, file := range scope.fixable(program) {
		directory := program.GetNearestAncestorDirectoryWithPackageJson(file.FileName().Directory())
		if directory == "" {
			continue
		}
		info := program.GetPackageJsonInfo(directory.ResolveFile("package.json"))
		if !info.Exists() {
			continue
		}
		packageName, named := info.Contents.Name.GetValue()
		if !named || packageName != "" {
			continue
		}
		module := strings.TrimPrefix(tspath.RemoveFileExtension(file.FileName().AsString()), directory.AsString()+"/")
		var edits []sourceEdit
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsClassDeclaration(node) && node.Name() != nil && declarationWord(node) == "service" {
				hasKey := false
				for _, member := range node.Members() {
					if ast.IsStatic(member) && member.Name() != nil && ast.IsPropertyNameLiteral(member.Name()) && member.Name().Text() == serviceKeyName {
						hasKey = true
						break
					}
				}
				at := node.ClassLikeData().Members.Pos()
				if !hasKey && at > 0 && at <= len(file.Text()) && file.Text()[at-1] == '{' {
					legacyKey := module + "#" + node.Name().Text()
					if prefix := directory.BaseName(); prefix != "" {
						legacyKey = prefix + "/" + legacyKey
					}
					key, _ := json.Marshal(legacyKey)
					edits = append(edits, sourceEdit{at, at, " static readonly key = " + string(key) + ";"})
				}
			}
			return node.ForEachChild(visit)
		}
		visit(file.AsNode())
		if ctx.Err() != nil {
			return changed
		}
		if len(edits) == 0 {
			continue
		}
		name := file.FileName()
		fixed := result.Files[name]
		if fixed == nil {
			fixed = &FixedFile{Original: file.Text(), Counts: map[int32]int{}, Rewrites: map[string]int{}}
			result.Files[name] = fixed
			result.Order = append(result.Order, name)
		}
		if fixed.Rewrites == nil {
			fixed.Rewrites = map[string]int{}
		}
		fixed.Rewrites["legacy service keys"] += len(edits)
		fixed.Text = applyEdits(file.Text(), edits)
		texts[name] = fixed.Text
		changed = true
	}
	return changed
}

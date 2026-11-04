package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// materializeLegacyReadonly reads existing source under the explicitly requested
// pre-flip schema/service and nested payload defaults, before the ordinary fix
// gate takes its baseline. Comparing this upgrade with the new writable interpretation is
// incorrect: removing a synthetic mutableKey around an invalid schema reference
// can expose downstream TS4111 errors that the old readonly API already had.
// This stage only inserts member modifiers. Codec expansions and every other
// rewrite still go through the ordinary project-wide gate.
func materializeLegacyReadonly(ctx context.Context, program *compiler.Program, scope *fixScope, texts map[tspath.RootedFilePath]string, result *FixResult) {
	for _, file := range scope.fixable(program) {
		p := schemaReadonlyMigrationFixes(ctx, program, file, map[string]bool{})
		p = p.withFixes(serviceReadonlyMigrationFixes(ctx, program, file, map[string]bool{}))
		p = p.withFixes(errorPayloadReadonlyMigrationFixes(ctx, program, file, map[string]bool{}))
		p = p.withFixes(dataPayloadReadonlyMigrationFixes(ctx, program, file, map[string]bool{}))
		modifiers := proposal{file: file}
		for _, f := range p.fixes {
			if f.label != schemaReadonlyLabel && f.label != serviceReadonlyLabel && f.label != errorPayloadReadonlyLabel && f.label != dataPayloadReadonlyLabel {
				continue
			}
			onlyModifiers := len(f.edits) > 0
			for _, edit := range f.edits {
				onlyModifiers = onlyModifiers && edit.start == edit.end && edit.text == "readonly "
			}
			if onlyModifiers {
				modifiers.fixes = append(modifiers.fixes, f)
			}
		}
		if len(modifiers.fixes) == 0 {
			continue
		}
		name := file.FileName()
		fixed := &FixedFile{Original: file.Text(), Text: modifiers.text(), Counts: map[int32]int{}, Rewrites: map[string]int{}}
		for _, f := range modifiers.fixes {
			fixed.Rewrites[f.label]++
			result.LegacyReadonlyFields++
		}
		result.Files[name] = fixed
		result.Order = append(result.Order, name)
		texts[name] = fixed.Text
	}
}

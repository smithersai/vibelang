package vibelang

import (
	"context"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// A relic migration promises byte-identical declarations (007). Checking
// diagnostics alone misses changed inferred return types. Check this proposal
// before combining it with the ordinary diagnostic fixes, which may deliberately
// change an API. Refuse the migration as a unit, including its helper imports.
func preserveRelicDeclarations(ctx context.Context, before *compiler.Program, texts map[tspath.RootedFilePath]string, p proposal, build func(map[tspath.RootedFilePath]string) *compiler.Program, refuse func(FixRefusal, string)) proposal {
	if len(p.fixes) == 0 {
		return p
	}
	baseline := baselineOf(ctx, before)
	original := relicDeclarationBytes(ctx, before)
	after := build(maps(texts, map[tspath.RootedFilePath]string{p.file.FileName(): p.text()}))
	// Reject newly ill-typed candidates before forcing their declaration emit.
	if added := addedErrors(ctx, after, baseline); len(added) > 0 {
		message := added[0]
		for _, fix := range p.fixes {
			line, _ := scannerLineOf(p.file, firstEdit(fix.edits))
			refuse(FixRefusal{File: p.file.FileName(), Line: line + 1, Code: fix.code, Label: fix.label, Error: message}, fix.key)
		}
		p.fixes = nil
		return p
	}
	fixed := relicDeclarationBytes(ctx, after)
	var names []tspath.RootedFilePath
	for name := range original {
		names = append(names, name)
	}
	for name := range fixed {
		if _, ok := original[name]; !ok {
			names = append(names, name)
		}
	}
	slices.SortFunc(names, tspath.RootedFilePath.Compare)
	for _, name := range names {
		a, aok := original[name]
		b, bok := fixed[name]
		if aok == bok && a == b {
			continue
		}
		for _, fix := range p.fixes {
			line, _ := scannerLineOf(p.file, firstEdit(fix.edits))
			refuse(FixRefusal{File: p.file.FileName(), Line: line + 1, Code: fix.code, Label: fix.label, Error: "declaration output changes in " + name.AsString() + "; migration left unchanged"}, fix.key)
		}
		p.fixes = nil
		break
	}
	return p
}

func relicDeclarationBytes(ctx context.Context, program *compiler.Program) map[tspath.RootedFilePath]string {
	output := map[tspath.RootedFilePath]string{}
	program.Emit(ctx, compiler.EmitOptions{EmitOnly: compiler.EmitOnlyDts, ForceEmit: true, WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if tspath.IsDeclarationFileName(name.AsString()) {
			output[name] = text
		}
		return nil
	}})
	return output
}

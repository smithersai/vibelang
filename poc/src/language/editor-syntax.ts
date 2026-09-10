import { basename } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";

export interface EditorModuleLink {
  readonly specifier: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Authored static import/re-export links from native parser recovery. These
 * are syntax facts, not resolved bindings, effects or an authorization proof.
 * The literal's own range excludes import attributes and unrelated strings.
 */
export function editorModuleLinks(source: string, fileName: string): readonly EditorModuleLink[] {
  // Inspection labels are virtual relative paths, never disk inputs. The
  // editor's absolute URI remains the host's identity/resolution key; only
  // this isolated parser label is reduced to a basename.
  const label = basename(fileName.replaceAll("\\", "/"));
  const inspected = getNativeCompiler().inspect([{path:label,text:source,scriptKind:"typescript"}]).files[0]!;
  const links: EditorModuleLink[] = [];
  for (const item of inspected.moduleSyntax) {
    if (!item.topLevel || (item.kind !== "import-declaration" && item.kind !== "module-re-export") ||
      item.specifierKind !== "string" || item.specifier === undefined || item.specifierSpan === undefined) continue;
    links.push(Object.freeze({specifier:item.specifier,start:item.specifierSpan.start,end:item.specifierSpan.start+item.specifierSpan.length}));
  }
  return Object.freeze(links);
}

import { isAbsolute, posix } from "node:path";

/** Check local links against the archive inventory, not the source checkout. */
export function packagedMarkdownLinkViolations(file, source, paths) {
  const pathSet = new Set(paths);
  const violations = [];
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    const link = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
    const local = link.split(/[?#]/, 1)[0];
    let decoded;
    try {
      decoded = decodeURIComponent(local);
    } catch {
      violations.push(`packaged Markdown has an invalid percent-encoded link: ${file} -> ${link}`);
      continue;
    }
    if (!decoded || decoded.includes("\\") || isAbsolute(decoded)) {
      violations.push(`packaged Markdown has an unsafe local link: ${file} -> ${link}`);
      continue;
    }
    const target = posix.normalize(posix.join(posix.dirname(file), decoded));
    if (target.startsWith("../") || !pathSet.has(target)) {
      violations.push(`packaged Markdown links to an unshipped file: ${file} -> ${link}`);
    }
  }
  return violations;
}

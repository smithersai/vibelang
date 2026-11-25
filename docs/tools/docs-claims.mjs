const fence = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm

export function deferredSupport(markdown) {
  return markdown.replace(fence, "").split(/\n[ \t]*\n/)
    .map(paragraph => paragraph.replaceAll("`", "").replace(/\s+/g, " ").trim())
    .filter(paragraph => /\bsupport for [^.!?]*\bnew\b[^.!?]*\b(?:arrives|will arrive)\b/i.test(paragraph))
}

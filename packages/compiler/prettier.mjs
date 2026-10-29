// Prettier delegates the entire file to VibeLang's own formatter.
// Keeping the formatted text as one doc prevents Prettier from changing it.
import { formatSource } from "./format.mjs"
export const languages = [{ name: "VibeLang", parsers: ["vibelang"], extensions: [".vibe"], vscodeLanguageIds: ["vibelang"] }]
export const parsers = {
  vibelang: {
    parse: (text, options) => ({ text: formatSource(text, options.filepath), sourceLength: text.length }),
    astFormat: "vibelang-formatted",
    locStart: () => 0,
    locEnd: node => node.sourceLength
  }
}
export const printers = {
  "vibelang-formatted": {
    print: path => path.getValue().text,
    // Positions describe the input, not the program compared by --debug-check.
    massageAstNode: (node, copy) => { delete copy.sourceLength }
  }
}

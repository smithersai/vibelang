// The comment that hands a loaded module its source map. Split, so a tool that
// reads this file for its own source map skips the template.
export const inlineSourceMap = (map) =>
  `//# sourceMapping${"URL"}=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}`

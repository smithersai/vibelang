import {createHash} from "node:crypto"
import ts from "typescript"
export const digest=text=>createHash("sha256").update(text).digest("hex")
export function executableDigest(source) {
 const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,source),tokens=[]
 for(let k=scanner.scan();k!==ts.SyntaxKind.EndOfFileToken;k=scanner.scan()) tokens.push([k,scanner.getTokenText()])
 return digest(JSON.stringify(tokens))
}

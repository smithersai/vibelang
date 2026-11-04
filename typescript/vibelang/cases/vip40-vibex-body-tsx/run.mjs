import { existsSync } from "node:fs"
const out = new URL("./out/", import.meta.url)
console.log(JSON.stringify(["main.vibex.view.jsx", "main.vibex.view.js"].map((name) => existsSync(new URL(name, out)))))

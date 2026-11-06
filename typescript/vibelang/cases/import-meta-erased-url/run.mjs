import assert from "node:assert/strict";
import{reads}from"./out/main.js";
const expected=new URL("./out/main.js",import.meta.url).href;
assert.equal(reads.length,8);assert.ok(reads.every(url=>url===expected));
console.log(JSON.stringify({count:reads.length,same:true}));

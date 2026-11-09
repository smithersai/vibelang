import assert from "node:assert/strict"
import * as m from "./out/main.js"
for(const name of ["literalLeft","literalRight","unionLeft","unionRight"]) {assert.equal(m[name]("spec"),"spec");assert.equal(m[name]("other"),"none")}
for(const name of ["arrayLeft","arrayRight"]) {assert.equal(m[name](["tasks"]),"tasks");assert.equal(m[name](["other"]),"none")}
assert.equal(m.nested("tasks"),"tasks")
assert.equal(m.nested("spec"),"none")
assert.equal(m.nonNarrowing("other"),"other")
for(const name of ["objectOrLeft","objectOrRight"]) {
 assert.equal(m[name]({_tag:"Square",side:3}),3)
 assert.equal(m[name]({_tag:"Rect",side:4}),4)
 assert.equal(m[name]({_tag:"Circle",radius:5}),0)
}
assert.equal(m.freshGuard(),0)
console.log("ok conjunction binding types and values")

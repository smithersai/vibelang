import{Effect}from"effect"
import{parent,failure,events}from"./lib.js"

function expression(fail:boolean){
 try{const C=class extends parent(fail){};return new C().value}
 catch(error){events.push("caught");return error===failure?-1:-2}
}
function declaration(fail:boolean){
 try{class C extends parent(fail){};return new C().value}
 catch(error){events.push("caught");return error===failure?-1:-2}
}

export function main(){return Effect.gen(function*(){return [[expression(false),expression(true),declaration(false),declaration(true)],events]})}

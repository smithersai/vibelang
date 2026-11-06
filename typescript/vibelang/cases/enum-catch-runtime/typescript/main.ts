import{Effect}from"effect"
import{number,tag,Factory,failure,events}from'./lib.js'
function call(fail:boolean){
 try{enum Local{Value=number(fail)};return Local.Value as number}
 catch(error){events.push("caught");return error===failure?-1:-2}
}
function tagged(fail:boolean){
 try{enum Local{Value=tag`value:${fail}`};return Local.Value as number}
 catch(error){events.push("caught");return error===failure?-1:-2}
}
function construct(fail:boolean){
 try{enum Local{Value=new Factory(fail).value};return Local.Value as number}
 catch(error){events.push("caught");return error===failure?-1:-2}
}

export function main(){return Effect.gen(function*(){return [[call(false),call(true),tagged(false),tagged(true),construct(false),construct(true)],events]})}

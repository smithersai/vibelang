/** @throws {never} */
export function items(trace:string[],failGet:boolean,failClose:boolean) {
 const iterator=(function*(){try{trace.push("start");yield {get value():number{trace.push("get");if(failGet)throw new Error("test");return 1}};trace.push("second");yield 2}finally{trace.push("close");if(failClose)throw new Error("close")}})();
 const original=iterator.return;
 Object.defineProperty(iterator,"return",{get(){trace.push("get-return");return function(...args:unknown[]){trace.push("return:"+args.length);return Reflect.apply(original,iterator,args)}}});
 return iterator;
}

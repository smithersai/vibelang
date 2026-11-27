//go:build js && wasm

// Command vibelang-wasm exposes the in-memory VibeLang compiler to JavaScript
// via window.vibelangCompile({ filename, source }).
package main

import (
	"syscall/js"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangwasm"
)

func main() {
	global := js.Global()
	global.Set("vibelangCompile", js.FuncOf(compileBridge))
	global.Set("__vibelangWasmReady", js.ValueOf(true))
	notifyReady(global)
	select {}
}

func compileBridge(_ js.Value, args []js.Value) any {
	req := parseRequest(args)
	resp := vibelangwasm.CompileInMemory(req)
	return encodeResponse(resp)
}

func parseRequest(args []js.Value) vibelangwasm.CompileRequest {
	if len(args) == 0 || args[0].IsUndefined() || args[0].IsNull() {
		return vibelangwasm.CompileRequest{Filename: "playground.vibe"}
	}
	arg := args[0]
	if arg.Type() == js.TypeString {
		return vibelangwasm.CompileRequest{
			Filename: "playground.vibe",
			Source:   arg.String(),
		}
	}
	var req vibelangwasm.CompileRequest
	if v := arg.Get("filename"); v.Type() == js.TypeString {
		req.Filename = v.String()
	}
	if v := arg.Get("source"); v.Type() == js.TypeString {
		req.Source = v.String()
	}
	return req
}

func encodeResponse(resp vibelangwasm.CompileResponse) js.Value {
	diags := js.Global().Get("Array").New(len(resp.Diagnostics))
	for i, d := range resp.Diagnostics {
		entry := js.Global().Get("Object").New()
		entry.Set("code", d.Code)
		entry.Set("severity", d.Severity)
		entry.Set("message", d.Message)
		entry.Set("line", d.Line)
		entry.Set("col", d.Col)
		entry.Set("endLine", d.EndLine)
		entry.Set("endCol", d.EndCol)
		diags.SetIndex(i, entry)
	}
	out := js.Global().Get("Object").New()
	out.Set("js", resp.JS)
	out.Set("dts", resp.DTS)
	out.Set("tsProjection", resp.TSProjection)
	out.Set("diagnostics", diags)
	out.Set("elapsedMs", resp.ElapsedMs)
	return out
}

func notifyReady(global js.Value) {
	eventCtor := global.Get("Event")
	dispatch := global.Get("dispatchEvent")
	if eventCtor.Type() == js.TypeFunction && dispatch.Type() == js.TypeFunction {
		dispatch.Invoke(eventCtor.New("vibelang-wasm-ready"))
	}
}

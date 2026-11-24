async function boot() {
  importScripts("./wasm_exec.js");
  const go = new Go();
  const response = await fetch("./engine.wasm");
  if (!response.ok) throw new Error(`Wasm could not be loaded (HTTP ${response.status}).`);

  const mediaType = response.headers.get("content-type")?.split(";")[0];
  const { instance } = mediaType === "application/wasm"
    ? await WebAssembly.instantiateStreaming(response, go.importObject)
    : await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject);
  go.run(instance).then(
    () => postMessage({ fatal: "The game engine stopped." }),
    error => postMessage({ fatal: String(error) }),
  );
  self.onmessage = ({ data }) => {
    const result = JSON.parse(self.gothelloDispatch(JSON.stringify(data)));
    postMessage(result);
  };
  postMessage({ ready: true });
}

boot().catch(error => postMessage({ fatal: String(error) }));

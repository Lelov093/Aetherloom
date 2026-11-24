// Trusted bundled renderer only. No Runtime token, credentials or cognition.
(() => {
  let receive;
  const send = (value) =>
    parent.postMessage(
      { source: "aetherloom-academy", ...value },
      location.origin,
    );
  window.AetherloomAcademy = {
    register(callback) {
      receive = callback;
      send({ type: "ready" });
    },
    send(json) {
      send(JSON.parse(json));
    },
    progress(current, total) {
      send({ type: "progress", current, total });
    },
    fail(text) {
      send({ type: "error", text });
    },
  };
  addEventListener("message", (event) => {
    if (
      event.source !== parent ||
      event.origin !== location.origin ||
      event.data?.source !== "aetherloom-academy-host"
    )
      return;
    if (receive) receive(JSON.stringify(event.data));
  });
  addEventListener("error", (event) =>
    send({ type: "error", text: event.message }),
  );
  addEventListener("unhandledrejection", (event) =>
    send({ type: "error", text: String(event.reason) }),
  );
  addEventListener("DOMContentLoaded", () =>
    document
      .querySelector("canvas")
      ?.addEventListener("webglcontextlost", () =>
        send({ type: "error", text: "场景显卡上下文已中断，请重试。" }),
      ),
  );
  addEventListener("pagehide", () => {
    receive = undefined;
  });
})();

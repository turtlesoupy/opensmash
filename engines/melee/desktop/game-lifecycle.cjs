// Keep native ownership outside the renderer, which can reload or crash.
module.exports = function createGameLifecycle(request, surface) {
  let pending = Promise.resolve();
  function enqueue(action) {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  }
  return {
    reset() {
      surface?.ready(false);
      surface?.clearInput();
      return enqueue(() => request("/api/native/stop", {}));
    },
    begin(session) {
      return enqueue(() => request("/api/native/begin", { session }));
    },
  };
};

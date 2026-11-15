/* Anonymous presence: visible browsers seen in the last 90 seconds, not a person counter. */
(function (root) {
  "use strict";

  function createPresenceClient(options) {
    var opts = options || {};
    var onCount = typeof opts.onCount === "function" ? opts.onCount : function () {};
    var onUnavailable = typeof opts.onUnavailable === "function" ? opts.onUnavailable : function () {};
    var baseIntervalMs = Math.max(5000, Number(opts.intervalMs) || 30000);
    var fetchImpl = typeof opts.fetchImpl === "function"
      ? opts.fetchImpl
      : (typeof fetch === "function" ? fetch.bind(root) : null);

    var timer = null;
    var pending = false;
    var stopped = true;
    var failures = 0;

    function clearTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function scheduleNext() {
      clearTimer();
      if (stopped) return;
      if (typeof document !== "undefined" && document.hidden) return;
      var delay = Math.min(120000, baseIntervalMs * Math.pow(2, failures));
      timer = setTimeout(beat, delay);
    }

    async function beat() {
      clearTimer();
      if (stopped || pending || !fetchImpl) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        onUnavailable(true);
        return;
      }
      pending = true;
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timeout = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
      try {
        var extraHeaders = typeof opts.getHeaders === "function" ? opts.getHeaders() : null;
        var payload = typeof opts.getPayload === "function" ? opts.getPayload() : null;
        var reqOpts = {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller ? controller.signal : undefined,
        };
        var headersObj = extraHeaders && typeof extraHeaders === "object" ? Object.assign({}, extraHeaders) : {};
        if (payload && typeof payload === "object") {
          headersObj["Content-Type"] = "application/json";
          reqOpts.body = JSON.stringify(payload);
        }
        if (Object.keys(headersObj).length > 0) reqOpts.headers = headersObj;
        var response = await fetchImpl("/api/presence", reqOpts);
        var data = await response.json();
        if (!response.ok || !data || !data.ok || !Number.isInteger(data.online) || data.online < 0) {
          throw new Error("Unavailable");
        }
        failures = 0;
        onCount(data.online, data);
      } catch (_err) {
        failures += 1;
        onUnavailable(typeof navigator !== "undefined" && navigator.onLine === false);
      } finally {
        if (timeout !== null) clearTimeout(timeout);
        pending = false;
        scheduleNext();
      }
    }

    function handleVisibility() {
      clearTimer();
      if (!stopped && typeof document !== "undefined" && !document.hidden) beat();
    }

    function handleOnline() {
      if (!stopped) beat();
    }

    function handleOffline() {
      clearTimer();
      onUnavailable(true);
    }

    function handlePagehide() {
      clearTimer();
    }

    function start() {
      if (!stopped) return;
      stopped = false;
      if (typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("visibilitychange", handleVisibility);
      }
      if (root && root.addEventListener) {
        root.addEventListener("online", handleOnline);
        root.addEventListener("offline", handleOffline);
        root.addEventListener("pagehide", handlePagehide);
      }
      beat();
    }

    function stop() {
      stopped = true;
      clearTimer();
      if (typeof document !== "undefined" && document.removeEventListener) {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
      if (root && root.removeEventListener) {
        root.removeEventListener("online", handleOnline);
        root.removeEventListener("offline", handleOffline);
        root.removeEventListener("pagehide", handlePagehide);
      }
    }

    return { start: start, stop: stop, ping: beat };
  }

  function wire() {
    if (typeof document === "undefined") return;
    var badge = document.getElementById("sitePresence");
    if (!badge) return;
    var label = badge.querySelector("[data-presence-label]");
    var client = createPresenceClient({
      onCount: function (online) {
        var formatted = new Intl.NumberFormat("en").format(online);
        if (label) label.textContent = formatted + " online";
        badge.dataset.onlineCount = formatted;
        badge.setAttribute("aria-label", online + " online");
        badge.dataset.status = "connected";
        badge.setAttribute("title", "Active browsers seen in the last 90 seconds. Multiple tabs in one browser count once; this is an approximate visitor count.");
      },
      onUnavailable: function (isOffline) {
        badge.removeAttribute("aria-label");
        badge.dataset.status = "unavailable";
        if (label) label.textContent = isOffline ? "Offline" : "Live count unavailable";
        badge.setAttribute("title", "The live connection is unavailable; no estimated number is shown.");
      },
    });
    client.start();
  }

  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.Presence = { createPresenceClient: createPresenceClient };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
    else wire();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createPresenceClient: createPresenceClient };
  }
})(typeof window !== "undefined" ? window : globalThis);

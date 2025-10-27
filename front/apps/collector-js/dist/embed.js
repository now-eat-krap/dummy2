(function () {
  if (!window.apilog) {
    var q = [];
    window.apilog = {
      __q: q,
      init: function(){ q.push(["init", arguments]); },
      trackEvent: function(){ q.push(["trackEvent", arguments]); },
      flushNow: function(){ q.push(["flushNow", arguments]); }
    };
  }

  try {
    var current = document.currentScript;
    var siteId = current.getAttribute("data-site-id") || "";
    var ingestUrl = current.getAttribute("data-ingest-url") || "";

    window.apilog.init({
      siteId: siteId,
      ingestUrl: ingestUrl
    });
  } catch (e) {
    console.warn("[apilog] auto init failed", e);
  }
})();

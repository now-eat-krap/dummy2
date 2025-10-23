(function () {
  var S = document.currentScript || {};
  var EP = (S.dataset && S.dataset.endpoint) || 'http://localhost:8080';
  var VPs = ((S.dataset && S.dataset.viewports) || '1366x900').split(',').map(function(s){return s.trim();}).filter(Boolean);
  var MODE = ((S.dataset && S.dataset.mode) || 'auto').toLowerCase();
  var PROBE = ((S.dataset && S.dataset.probe) || 'on').toLowerCase() === 'on';
  var SCROLLEE = (S.dataset && S.dataset.scrollContainer) || null;
  var MAX_STEPS = +((S.dataset && S.dataset.maxSteps) || 28);
  var WAIT_MS   = +((S.dataset && S.dataset.waitMs)   || 700);
  var MAX_TIME  = +((S.dataset && S.dataset.maxTimeMs)|| 45000);
  var MIN_DELTA = +((S.dataset && S.dataset.minDelta) || 80);
  var PLATEAU   = +((S.dataset && S.dataset.plateauNeed) || 2);
  var url = (S.dataset && S.dataset.url) || location.href.split('#')[0];
  var once = 'snap:queued:' + url;
  if (sessionStorage.getItem(once)) return;
  sessionStorage.setItem(once, '1');
  function probeGrow() {
    if (!PROBE) return Promise.resolve({ probed:false, heightGrew:true });
    var before = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    try { window.scrollBy(0, Math.floor(window.innerHeight*0.9)); } catch(e){}
    return new Promise(function(r){ setTimeout(r, 400); }).then(function(){
      try { window.scrollBy(0, Math.floor(window.innerHeight*0.9)); } catch(e){}
      return new Promise(function(r){ setTimeout(r, 400); }).then(function(){
        var after = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        return { probed:true, heightGrew: (after - before) > 64 };
      });
    });
  }
  function buildPayload(heightGrew) {
    var cap;
    if (MODE === 'static') cap = { mode:'static' };
    else if (MODE === 'scroll') cap = { mode:'scroll', maxSteps:MAX_STEPS, waitMs:WAIT_MS, maxTimeMs:MAX_TIME, minDeltaPx:MIN_DELTA, plateauNeed:PLATEAU, scrollContainer:SCROLLEE };
    else cap = heightGrew ? { mode:'scroll', maxSteps:MAX_STEPS, waitMs:WAIT_MS, maxTimeMs:MAX_TIME, minDeltaPx:MIN_DELTA, plateauNeed:PLATEAU, scrollContainer:SCROLLEE }
                          : { mode:'static' };
    return { url:url, viewports: VPs, capture: cap };
  }
  (MODE === 'auto' ? probeGrow() : Promise.resolve({ heightGrew:true }))
  .then(function(res){
    var payload = buildPayload(res.heightGrew);
    return fetch(EP.replace(/\/$/,'') + '/queue', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload), mode:'cors', credentials:'omit'
    }).catch(function(){});
  });
})();
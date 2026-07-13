// Dominik's Dashboard — Fitness cloud sync.
//
// Provides the global initCloudSync() that the endurance module calls. It
// stores a set of localStorage keys as ONE JSONB row in public.app_state,
// keyed by appKey, in the SAME Supabase project the gym section uses — so the
// whole fitness page shares one backend. Supabase realtime keeps every device
// in step. Loaded with `defer`, so window.supabase (from the CDN, loaded just
// above) exists by the time this runs, and this runs before the endurance
// module's DOMContentLoaded handler calls initCloudSync().
//
// This mirrors the gym section's inline "pc" sync exactly, generalised over a
// list of keys. It is safe alongside that inline sync: it chains (not replaces)
// the existing localStorage.setItem wrapper, and only reacts to its own keys.
(function () {
  'use strict';

  // Same project + publishable (anon) key the gym section hardcodes. Anon keys
  // are meant to live in the browser; data is protected by row-level security.
  var SUPABASE_URL = 'https://gcqaaunceyzjciwbwphj.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_d1PEu6Pu4_ruTXgF7kU6mA_kR5SKEO4';

  function initCloudSync(opts) {
    opts = opts || {};
    var appKey = opts.appKey;
    var keys = opts.syncedKeys || [];
    var onApplied = typeof opts.onApplied === 'function' ? opts.onApplied : function () {};

    if (!appKey || !keys.length) return;
    if (!window.supabase || !SUPABASE_URL || !SUPABASE_KEY) return;
    if (SUPABASE_URL.indexOf('PASTE-') === 0 || SUPABASE_KEY.indexOf('PASTE-') === 0) return;

    var supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    var pushTimer = null;
    var suppress = false;      // true while WE write remote data locally
    var pending = null;        // remote state held back while the user types
    var lastJson = null;       // ignore realtime echoes of our own pushes

    function collect() {
      var out = {};
      for (var i = 0; i < keys.length; i++) {
        var v = localStorage.getItem(keys[i]);
        if (v == null) continue;
        try { out[keys[i]] = JSON.parse(v); } catch (e) {}
      }
      return out;
    }

    function isEditing() {
      var ae = document.activeElement;
      if (!ae) return false;
      var t = ae.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
      if (ae.getAttribute && ae.getAttribute('contenteditable') === 'true') return true;
      return false;
    }

    function applyRemote(remote) {
      suppress = true;
      try {
        for (var k in remote) {
          if (keys.indexOf(k) === -1) continue;
          try { localStorage.setItem(k, JSON.stringify(remote[k])); } catch (e) {}
        }
      } finally { suppress = false; }
      try { onApplied(); } catch (e) {}
    }

    function maybeApply(remote) {
      if (isEditing()) { pending = remote; return; }
      applyRemote(remote);
    }

    function applyPendingIfReady() {
      if (pending && !isEditing()) {
        var r = pending; pending = null; applyRemote(r);
      }
    }

    function pushNow() {
      var state = collect();
      var json = JSON.stringify(state);
      if (json === lastJson) return Promise.resolve();
      return supa
        .from('app_state')
        .upsert(
          { key: appKey, data: state, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
        .then(function (res) { if (!res.error) lastJson = json; })
        .catch(function () {});
    }

    function schedulePush() {
      if (suppress) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushNow, 250);
    }

    // Backup push on unload via fetch keepalive, so a fast refresh doesn't lose
    // the latest change before the debounced push fires.
    function flushOnUnload() {
      var state = collect();
      var json = JSON.stringify(state);
      if (json === lastJson) return;
      try {
        fetch(SUPABASE_URL + '/rest/v1/app_state?on_conflict=key', {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
          },
          body: JSON.stringify({ key: appKey, data: state, updated_at: new Date().toISOString() }),
          keepalive: true
        }).catch(function () {});
        lastJson = json;
      } catch (e) {}
    }

    // Chain (not replace) any existing setItem/removeItem wrapper — the gym
    // section installs its own during page parse. We call the previous
    // implementation first, then schedule a push only for OUR keys.
    var prevSet = localStorage.setItem.bind(localStorage);
    var prevRemove = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      prevSet(k, v);
      try { if (!suppress && keys.indexOf(k) !== -1) schedulePush(); } catch (e) {}
    };
    localStorage.removeItem = function (k) {
      prevRemove(k);
      try { if (!suppress && keys.indexOf(k) !== -1) schedulePush(); } catch (e) {}
    };

    // Initial pull, then subscribe to realtime changes for this key.
    (function () {
      supa.from('app_state').select('data').eq('key', appKey).maybeSingle()
        .then(function (res) {
          if (!res.error && res.data && res.data.data && Object.keys(res.data.data).length > 0) {
            lastJson = JSON.stringify(res.data.data);
            maybeApply(res.data.data);
          } else if (Object.keys(collect()).length > 0) {
            // Nothing in the cloud yet but we have local data — seed it.
            schedulePush();
          }
        })
        .catch(function () {});

      supa.channel('app_state_' + appKey)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'app_state',
          filter: 'key=eq.' + appKey
        }, function (payload) {
          if (!payload.new || !payload.new.data) return;
          var incoming = JSON.stringify(payload.new.data);
          if (incoming === lastJson) return; // echo of our own push
          lastJson = incoming;
          maybeApply(payload.new.data);
        })
        .subscribe();
    })();

    document.addEventListener('focusout', function () {
      setTimeout(applyPendingIfReady, 0);
    }, true);
    window.addEventListener('pagehide', flushOnUnload);
    window.addEventListener('beforeunload', flushOnUnload);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) flushOnUnload();
    });
  }

  window.initCloudSync = initCloudSync;
})();

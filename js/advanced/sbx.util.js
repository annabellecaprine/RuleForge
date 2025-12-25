(function (root) {
  'use strict';
  if (!root || !root.SBX) { throw new Error('sbx.util.js requires sbx.ns.js loaded first'); }

  var U = root.SBX.util;

  // ---------- type helpers ----------
  U.isArr = function (x) { return Object.prototype.toString.call(x) === '[object Array]'; };
  U.hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  // ---------- localStorage ----------
  U.lsGet = function (key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_e) { return fallback; }
  };
  U.lsSet = function (key, val) {
    try { localStorage.setItem(key, val); } catch (_e) { }
  };

  // ---------- misc ----------
  U.esc = function (s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  U.uid = function (prefix) {
    prefix = prefix || 'id';
    return prefix + '_' + Math.floor(Math.random() * 1e9);
  };

  U.splitLines = function (s) {
    s = String(s == null ? '' : s);
    var lines = s.split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = String(lines[i]).replace(/^\s+|\s+$/g, '');
      if (t) out.push(t);
    }
    return out;
  };

  U.normalizeBuildOrder = function (order) {
    if (!U.isArr(order)) return [];
    var out = [];
    var seen = {};
    for (var i = 0; i < order.length; i++) {
      var id = String(order[i]);
      if (!id || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  };

  U.safeJsonParse = function (raw, fallback) {
    try { return JSON.parse(raw); } catch (_e) { return fallback; }
  };

})(window);

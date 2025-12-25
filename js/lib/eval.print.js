/* ============================================================================
 * eval.print.js — Console Pretty Printer for EvalCore Reports (ES5)
 * ----------------------------------------------------------------------------
 * Depends on:
 *   - window.EvalCore
 *
 * Adds:
 *   EvalCore.print(report, options)
 *
 * options:
 *   - showAll: boolean        (default false) show all results, not just fired
 *   - showReasons: boolean    (default true)
 *   - showEffects: boolean    (default true)
 *   - showConflicts: boolean  (default true)
 *   - showTrace: boolean      (default false)
 *   - maxEffectItems: number  (default 50)
 * ============================================================================
 */
(function (root) {
  'use strict';

  if (!root.EvalCore) throw new Error('eval.print.js requires window.EvalCore');

  var EvalCore = root.EvalCore;

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function pad(n) { n = +n || 0; return (n < 10 ? '0' : '') + n; }
  function repeat(s, n) { var out = '', i; for (i = 0; i < n; i++) out += s; return out; }

  function safeStr(x) {
    if (x == null) return '';
    try { return String(x); } catch (_e) { return ''; }
  }

  function logGroup(title) {
    if (console && console.groupCollapsed) console.groupCollapsed(title);
    else if (console && console.log) console.log(title);
  }
  function endGroup() { if (console && console.groupEnd) console.groupEnd(); }

  function printReason(reason, indent) {
    indent = indent || 0;
    if (!reason) {
      console.log(repeat('  ', indent) + '(no reason)');
      return;
    }

    var line = repeat('  ', indent) +
      (reason.ok ? '✔ ' : '✖ ') +
      safeStr(reason.kind);

    console.log(line);

    // meta
    if (reason.meta && typeof reason.meta === 'object') {
      var keys = [];
      var k;
      for (k in reason.meta) if (hasOwn(reason.meta, k)) keys.push(k);
      keys.sort();

      if (keys.length) {
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          var val = reason.meta[key];

          // Keep meta compact: stringify primitives/short arrays
          var rendered;
          if (val == null) rendered = 'null';
          else if (typeof val === 'string') rendered = '"' + val + '"';
          else if (typeof val === 'number' || typeof val === 'boolean') rendered = String(val);
          else if (isArr(val)) rendered = '[len ' + val.length + '] ' + JSON.stringify(val);
          else rendered = JSON.stringify(val);

          console.log(repeat('  ', indent + 1) + '- ' + key + ': ' + rendered);
        }
      }
    }

    // children (and/or)
    if (reason.children && isArr(reason.children)) {
      for (var c = 0; c < reason.children.length; c++) {
        printReason(reason.children[c], indent + 1);
      }
    }

    // child (not)
    if (reason.child) {
      printReason(reason.child, indent + 1);
    }
  }

  function printEffects(effects, maxItems) {
    if (!effects) {
      console.log('(no effects)');
      return;
    }

    maxItems = (maxItems == null) ? 50 : (+maxItems || 50);

    function walk(obj, path, depth) {
      if (!obj) return;
      depth = depth || 0;
      if (depth > 6) return; // safety

      var k;
      for (k in obj) if (hasOwn(obj, k)) {
        var v = obj[k];
        var p = path ? (path + '.' + k) : k;

        if (isArr(v)) {
          console.log(p + ' = [ ' + v.length + ' items ]');
          var lim = v.length;
          if (lim > maxItems) lim = maxItems;
          for (var i = 0; i < lim; i++) {
            console.log('  - ' + safeStr(v[i]));
          }
          if (v.length > lim) console.log('  ... ' + (v.length - lim) + ' more');
        } else if (v && typeof v === 'object') {
          walk(v, p, depth + 1);
        } else {
          console.log(p + ' = ' + safeStr(v));
        }
      }
    }

    walk(effects, '', 0);
  }

  function printConflicts(conflicts) {
    if (!conflicts || !conflicts.length) {
      console.log('(no conflicts)');
      return;
    }
    for (var i = 0; i < conflicts.length; i++) {
      var g = conflicts[i];
      var rules = g.rules || [];
      console.log('[' + (i + 1) + '] ' + safeStr(g.kind) + ' "' + safeStr(g.key) + '" => ' + rules.length + ' rules');
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        console.log('    - [' + (r.priority || 0) + '] ' + r.moduleId + ': ' + (r.label || r.id));
      }
    }
  }

  function printTrace(trace) {
    if (!trace || !trace.length) {
      console.log('(no trace)');
      return;
    }

    // Group trace counts by kind + moduleId
    var map = {};
    for (var i = 0; i < trace.length; i++) {
      var e = trace[i] || {};
      var key = safeStr(e.kind) + '|' + safeStr(e.moduleId || '');
      map[key] = (map[key] || 0) + 1;
    }

    var keys = [];
    for (var k in map) if (hasOwn(map, k)) keys.push(k);
    keys.sort();

    for (i = 0; i < keys.length; i++) {
      var parts = keys[i].split('|');
      console.log(parts[0] + (parts[1] ? (' [' + parts[1] + ']') : '') + ': ' + map[keys[i]]);
    }

    // Also dump raw trace for deep debugging
    if (console && console.log) {
      console.log('Raw trace:', trace);
    }
  }

  EvalCore.print = function (report, options) {
    options = options || {};
    var showAll = !!options.showAll;
    var showReasons = (options.showReasons !== false);
    var showEffects = (options.showEffects !== false);
    var showConflicts = (options.showConflicts !== false);
    var showTrace = !!options.showTrace;
    var maxEffectItems = options.maxEffectItems;

    if (!report) {
      console.log('EvalCore.print: (no report)');
      return;
    }

    var results = report.results || [];
    var fired = report.fired || [];
    var conflicts = report.conflicts || [];
    var effects = report.effects || {};
    var trace = report.trace || [];

    // Header
    console.log('=== Eval Report ===');
    console.log('Rules:', results.length, 'Fired:', fired.length, 'Conflicts:', conflicts.length);

    // Fired or All Results
    logGroup(showAll ? ('Results (' + results.length + ')') : ('Fired (' + fired.length + ')'));
    var list = showAll ? results : fired;

    for (var i = 0; i < list.length; i++) {
      var r = list[i];

      var head = '[' + (r.priority || 0) + '] ' + safeStr(r.moduleId) + ': ' + safeStr(r.label || r.id);
      head += showAll ? (' => ' + (r.ok ? 'TRUE' : 'FALSE')) : '';

      if (console && console.groupCollapsed) console.groupCollapsed(head);
      else console.log(head);

      if (showReasons) {
        printReason(r.reason, 1);
      }

      if (r.targets && r.targets.length) {
        console.log('  targets: ' + JSON.stringify(r.targets));
      }

      endGroup();
    }
    endGroup();

    // Conflicts
    if (showConflicts) {
      logGroup('Conflicts (' + conflicts.length + ')');
      printConflicts(conflicts);
      endGroup();
    }

    // Effects
    if (showEffects) {
      logGroup('Effects');
      printEffects(effects, maxEffectItems);
      endGroup();
    }

    // Trace
    if (showTrace) {
      logGroup('Trace (' + trace.length + ')');
      printTrace(trace);
      endGroup();
    }
  };

})(window);

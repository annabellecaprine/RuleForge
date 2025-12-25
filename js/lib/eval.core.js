/* ============================================================================
 * eval.core.js — Rule Evaluation Core (ES5)
 * ----------------------------------------------------------------------------
 * Depends on:
 *   - window.Sources
 *   - window.Reasons
 *   - window.Sim (optional; caller may pass ctx explicitly)
 *
 * Rule format (minimal v1):
 *   {
 *     id: "mem_like_tea",
 *     label: "User likes tea",
 *     moduleId: "memory",
 *     priority: 70,
 *     targets: ["inject.pre"],     // used for conflict grouping
 *
 *     // Build and return a reason object (from Reasons.*)
 *     when: function (api) { return reasonObj; },
 *
 *     // Optional: return effects object if rule fires
 *     effects: function (api) { return effectsObj; },
 *
 *     // Optional: mutate shared state if rule fires
 *     commit: function (api) { ... }
 *   }
 *
 * api passed to rule functions:
 *   {
 *     moduleId,
 *     ctx,
 *     state,
 *     derived,
 *     Sources,
 *     Reasons,
 *     trace,
 *     read(sourceId),
 *     now()
 *   }
 * ============================================================================
 */
(function (root) {
  'use strict';

  if (!root.Sources) throw new Error('eval.core.js requires window.Sources');
  if (!root.Reasons) throw new Error('eval.core.js requires window.Reasons');

  var EvalCore = {};
  var Sources = root.Sources;
  var Reasons = root.Reasons;

  function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  function isArr(x) {
    return Object.prototype.toString.call(x) === '[object Array]';
  }

  function cloneJson(o) {
    return JSON.parse(JSON.stringify(o || {}));
  }

  // --------------------------------------------------------------------------
  // Effect merge helper
  // --------------------------------------------------------------------------
  function mergeEffects(into, add) {
    if (!add) return into || {};
    if (!into) into = {};

    var k, v, i;
    for (k in add) if (hasOwn(add, k)) {
      v = add[k];

      if (isArr(v)) {
        if (!isArr(into[k])) into[k] = [];
        for (i = 0; i < v.length; i++) into[k].push(v[i]);
      }
      else if (v && typeof v === 'object') {
        into[k] = mergeEffects(into[k] || {}, v);
      }
      else {
        into[k] = v;
      }
    }
    return into;
  }

  // --------------------------------------------------------------------------
  // Conflict grouping (shared target heuristic)
  // --------------------------------------------------------------------------
  function groupConflicts(fired) {
    var byTarget = {};
    var groups = [];
    var i, j, r, t;

    for (i = 0; i < fired.length; i++) {
      r = fired[i];
      if (!isArr(r.targets)) continue;

      for (j = 0; j < r.targets.length; j++) {
        t = String(r.targets[j]);
        if (!byTarget[t]) byTarget[t] = [];
        byTarget[t].push(r);
      }
    }

    for (t in byTarget) if (hasOwn(byTarget, t)) {
      if (byTarget[t].length > 1) {
        groups.push({
          kind: 'sharedTarget',
          key: t,
          rules: byTarget[t].slice(0)
        });
      }
    }

    return groups;
  }

  // --------------------------------------------------------------------------
  // API builder
  // --------------------------------------------------------------------------
  function buildApi(rule, ctx, state, derived, trace) {
    var moduleId = rule.moduleId || 'unknown';

    return {
      moduleId: moduleId,
      ctx: ctx,
      state: state,
      derived: derived,

      Sources: Sources,
      Reasons: Reasons,
      trace: trace,

      read: function (sourceId) {
        return Sources.read(
          moduleId,
          sourceId,
          ctx,
          state,
          derived,
          { strict: false, trace: trace }
        );
      },

      now: function () {
        var n = Sources.read(
          moduleId,
          'chat.messageCount',
          ctx,
          state,
          derived,
          { strict: false, trace: trace }
        );
        n = +n;
        return isNaN(n) ? 0 : n;
      }
    };
  }

  // --------------------------------------------------------------------------
  // Core runner
  // --------------------------------------------------------------------------
  EvalCore.runRules = function (rules, opts) {
    opts = opts || {};

    var ctx = opts.ctx || (root.Sim && root.Sim.getCtx ? root.Sim.getCtx() : {});
    var state = opts.state || {};
    var derived = opts.derived || {};
    var trace = opts.trace || [];

    rules = isArr(rules) ? rules.slice(0) : [];

    // Priority: high → low
    rules.sort(function (a, b) {
      return (+b.priority || 0) - (+a.priority || 0);
    });

    var results = [];
    var fired = [];
    var mergedEffects = {};

    var i, rule, api, reason, ok, eff;

    for (i = 0; i < rules.length; i++) {
      rule = rules[i];
      api = buildApi(rule, ctx, state, derived, trace);

      try {
        reason = (typeof rule.when === 'function')
          ? rule.when(api)
          : { kind: 'and', ok: true, meta: {}, children: [] };
      } catch (e) {
        reason = {
          kind: 'error',
          ok: false,
          meta: {
            message: 'when() threw',
            error: String(e && e.message ? e.message : e)
          }
        };
      }

      ok = !!(reason && reason.ok);

      results.push({
        id: rule.id || ('rule_' + i),
        label: rule.label || '',
        moduleId: api.moduleId,
        priority: +rule.priority || 0,
        targets: rule.targets || [],
        ok: ok,
        reason: reason
      });

      if (ok) {
        fired.push(results[results.length - 1]);

        if (typeof rule.commit === 'function') {
          try { rule.commit(api); } catch (e2) {}
        }

        if (typeof rule.effects === 'function') {
          try {
            eff = rule.effects(api);
            mergedEffects = mergeEffects(mergedEffects, eff);
          } catch (e3) {}
        }
      }
    }

    return {
      ctx: ctx,
      state: state,
      derived: derived,
      trace: trace,
      results: results,
      fired: fired,
      conflicts: groupConflicts(fired),
      effects: mergedEffects
    };
  };

  root.EvalCore = EvalCore;

})(window);

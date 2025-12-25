/* ============================================================================
 * dsl.compile.js — Rule DSL Compiler (ES5)
 * ----------------------------------------------------------------------------
 * Depends on:
 *   - window.Reasons
 *
 * Exposes:
 *   - window.DSL.compileRule(ruleSpec) -> EvalCore-compatible rule object
 *   - window.DSL.compileRules(array)   -> array of compiled rules
 *
 * v1 supports ReasonSpec types:
 *   termHit, anyTerms, allTerms, phraseHit, regexHit, countInWindow
 *   and, or, not
 *
 * v1 supports EffectSpec:
 *   map of "dot.path" -> array (or single) of strings
 *   example: { "inject.pre": ["..."], "inject.post": "..." }
 * ============================================================================
 */
(function (root) {
  'use strict';

  if (!root.Reasons) {
    throw new Error('dsl.compile.js requires window.Reasons');
  }

  var Reasons = root.Reasons;
  var DSL = {};

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function str(x) { return x == null ? '' : String(x); }

  // --------------------------------------------------------------------------
  // Effects: compile { "inject.pre": ["a","b"], "x.y": "z" } -> nested object
  // --------------------------------------------------------------------------

  function ensureObjPath(obj, parts) {
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!hasOwn(cur, p) || !cur[p] || typeof cur[p] !== 'object') {
        cur[p] = {};
      }
      cur = cur[p];
    }
    return cur;
  }

  function setEffectPath(effectsObj, path, arr) {
    var parts = str(path).split('.');
    if (!parts.length) return;

    var leafKey = parts.pop();
    var parent = ensureObjPath(effectsObj, parts);

    if (!isArr(parent[leafKey])) parent[leafKey] = [];

    for (var i = 0; i < arr.length; i++) {
      parent[leafKey].push(str(arr[i]));
    }
  }

  function compileEffects(effectSpec) {
    var out = {};
    if (!effectSpec || typeof effectSpec !== 'object') return out;

    for (var k in effectSpec) if (hasOwn(effectSpec, k)) {
      var v = effectSpec[k];
      if (!isArr(v)) v = [v];
      setEffectPath(out, k, v);
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Reasons: compile ReasonSpec -> function(api){ return reasonObj; }
  // --------------------------------------------------------------------------

  function errorReasonFn(msg, extra) {
    return function () {
      return { kind: 'error', ok: false, meta: { message: msg, extra: extra || null } };
    };
  }

  function compileReasonSpec(spec) {
    if (!spec || typeof spec !== 'object') {
      return errorReasonFn('Missing reason spec', null);
    }

    var type = str(spec.type);

    // ---- composition ----
    if (type === 'and' || type === 'or') {
      var children = isArr(spec.children) ? spec.children : [];
      var childFns = [];
      for (var i = 0; i < children.length; i++) {
        childFns.push(compileReasonSpec(children[i]));
      }

      return function (api) {
        var rs = [];
        for (var j = 0; j < childFns.length; j++) rs.push(childFns[j](api));
        return (type === 'and') ? Reasons.AND(rs) : Reasons.OR(rs);
      };
    }

    if (type === 'not') {
      var childFn = compileReasonSpec(spec.child);
      return function (api) {
        return Reasons.NOT(childFn(api));
      };
    }

    // ---- primitives ----
    if (type === 'termHit') {
      var src1 = str(spec.source);
      var term1 = str(spec.term);
      var mode1 = str(spec.mode || 'contains');
      return function (api) {
        return Reasons.termHit(api.Sources, api.moduleId, src1, term1, mode1, api.ctx, api.state, api.derived, api.trace);
      };
    }

    if (type === 'anyTerms') {
      var src2 = str(spec.source);
      var terms2 = isArr(spec.terms) ? spec.terms : [spec.terms];
      var mode2 = str(spec.mode || 'contains');
      return function (api) {
        return Reasons.anyTerms(api.Sources, api.moduleId, src2, terms2, mode2, api.ctx, api.state, api.derived, api.trace);
      };
    }

    if (type === 'allTerms') {
      var src3 = str(spec.source);
      var terms3 = isArr(spec.terms) ? spec.terms : [spec.terms];
      var mode3 = str(spec.mode || 'contains');
      return function (api) {
        return Reasons.allTerms(api.Sources, api.moduleId, src3, terms3, mode3, api.ctx, api.state, api.derived, api.trace);
      };
    }

    if (type === 'phraseHit') {
      var src4 = str(spec.source);
      var phrase4 = str(spec.phrase);
      return function (api) {
        return Reasons.phraseHit(api.Sources, api.moduleId, src4, phrase4, api.ctx, api.state, api.derived, api.trace);
      };
    }

    if (type === 'regexHit') {
      var src5 = str(spec.source);
      var pat5 = str(spec.pattern);
      var flg5 = str(spec.flags || '');
      return function (api) {
        return Reasons.regexHit(api.Sources, api.moduleId, src5, pat5, flg5, api.ctx, api.state, api.derived, api.trace);
      };
    }

    if (type === 'countInWindow') {
      var src6 = str(spec.source); // typically "history.norm"
      var terms6 = isArr(spec.terms) ? spec.terms : [spec.terms];
      var win6 = spec.window;
      var mode6 = str(spec.mode || 'contains');
      var min6 = spec.min;
      return function (api) {
        return Reasons.countInWindow(api.Sources, api.moduleId, src6, terms6, win6, mode6, min6, api.ctx, api.state, api.derived, api.trace);
      };
    }

    return errorReasonFn('Unknown reason type', type);
  }

  // --------------------------------------------------------------------------
  // Public compile API
  // --------------------------------------------------------------------------

  DSL.compileRule = function (ruleSpec) {
    ruleSpec = ruleSpec || {};

    var compiled = {
      id: ruleSpec.id,
      label: ruleSpec.label,
      moduleId: ruleSpec.moduleId,
      priority: ruleSpec.priority,
      targets: ruleSpec.targets
    };

    var whenFn = compileReasonSpec(ruleSpec.when);
    compiled.when = function (api) { return whenFn(api); };

    if (ruleSpec.effects) {
      // Precompile to constant object so evaluation is fast/deterministic
      var effObj = compileEffects(ruleSpec.effects);
      compiled.effects = function () { return effObj; };
    }

    // v1: commit/state writes come later
    return compiled;
  };

  DSL.compileRules = function (arr) {
    arr = isArr(arr) ? arr : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      out.push(DSL.compileRule(arr[i]));
    }
    return out;
  };

  root.DSL = DSL;

})(window);

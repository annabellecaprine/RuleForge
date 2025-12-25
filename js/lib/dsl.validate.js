/* ============================================================================
 * dsl.validate.js — Rule DSL Validator (ES5) — A.2
 * ----------------------------------------------------------------------------
 * Depends on:
 *   - window.Sources
 *
 * Exposes:
 *   - window.DSLValidate.validateRule(ruleSpec)  -> { errors:[], warnings:[] }
 *   - window.DSLValidate.validateRules(ruleSpecs)-> { errors:[], warnings:[], byRule:{} }
 *
 * v1 validates structure + known reason types + source existence.
 * A.2 adds "suspicious/unreachable" warnings using source kind awareness.
 * ============================================================================
 */
(function (root) {
  'use strict';

  if (!root.Sources) throw new Error('dsl.validate.js requires window.Sources');

  var Sources = root.Sources;
  var DSLValidate = {};

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function str(x) { return x == null ? '' : String(x); }

  // Allowed reason types in v1 compiler
  var REASON_TYPES = {
    termHit: true,
    anyTerms: true,
    allTerms: true,
    phraseHit: true,
    regexHit: true,
    countInWindow: true,
    and: true,
    or: true,
    not: true
  };

  function pushMsg(list, ruleId, path, msg) {
    list.push({ ruleId: ruleId || '', path: path || '', message: msg || '' });
  }

  function getSpec(sourceId) {
    return Sources.getSpec ? Sources.getSpec(sourceId) : null;
  }

  function sourceExists(sourceId) {
    return !!getSpec(sourceId);
  }

  function getSourceKind(sourceId) {
    var s = getSpec(sourceId);
    return s && s.kind ? String(s.kind) : '';
  }

  function looksMultiWord(s) {
    s = str(s).trim();
    return s.indexOf(' ') !== -1;
  }

  function validateEffects(ruleId, effects, targets, out) {
    if (effects == null) return;

    if (typeof effects !== 'object') {
      pushMsg(out.errors, ruleId, 'effects', 'effects must be an object like { "inject.pre": ["..."] }');
      return;
    }

    // Gather effect output paths
    var effectKeys = [];
    for (var k in effects) if (hasOwn(effects, k)) {
      if (!k || typeof k !== 'string') {
        pushMsg(out.errors, ruleId, 'effects', 'effect key must be a string dot-path');
        continue;
      }
      effectKeys.push(k);

      var v = effects[k];
      if (isArr(v)) {
        for (var i = 0; i < v.length; i++) {
          if (typeof v[i] !== 'string') {
            pushMsg(out.errors, ruleId, 'effects["' + k + '"][' + i + ']', 'effect items must be strings');
          }
        }
      } else if (typeof v !== 'string') {
        pushMsg(out.errors, ruleId, 'effects["' + k + '"]', 'effect value must be a string or array of strings');
      }
    }

    // A.2: Warn if effects outputs aren’t declared in targets
    if (effectKeys.length && isArr(targets) && targets.length) {
      var targetMap = {};
      for (var t = 0; t < targets.length; t++) targetMap[String(targets[t])] = true;

      for (var e = 0; e < effectKeys.length; e++) {
        var ek = effectKeys[e];
        if (!targetMap[ek]) {
          pushMsg(
            out.warnings,
            ruleId,
            'effects',
            'Effect path "' + ek + '" is not listed in targets[]; conflict detection may miss overlaps.'
          );
        }
      }
    }

    // A.2: Warn if effects object is empty
    if (effectKeys.length === 0) {
      pushMsg(out.warnings, ruleId, 'effects', 'effects is empty; rule may have no visible output');
    }
  }

  function validateReason(ruleId, spec, path, out) {
    if (!spec || typeof spec !== 'object') {
      pushMsg(out.errors, ruleId, path, 'Missing reason spec object');
      return;
    }

    var type = str(spec.type);
    if (!type) {
      pushMsg(out.errors, ruleId, path + '.type', 'Missing reason type');
      return;
    }
    if (!REASON_TYPES[type]) {
      pushMsg(out.errors, ruleId, path + '.type', 'Unknown reason type "' + type + '"');
      return;
    }

    // Composition
    if (type === 'and' || type === 'or') {
      if (!isArr(spec.children) || spec.children.length === 0) {
        pushMsg(out.errors, ruleId, path + '.children', 'Reason "' + type + '" requires a non-empty children array');
        return;
      }
      for (var i = 0; i < spec.children.length; i++) {
        validateReason(ruleId, spec.children[i], path + '.children[' + i + ']', out);
      }
      return;
    }

    if (type === 'not') {
      if (!spec.child) {
        pushMsg(out.errors, ruleId, path + '.child', 'Reason "not" requires a child');
        return;
      }
      validateReason(ruleId, spec.child, path + '.child', out);
      return;
    }

    // Helper: source existence + kind warnings
    function requireSource(p, sourceId) {
      if (!sourceId) {
        pushMsg(out.errors, ruleId, p, 'This reason requires "source"');
        return false;
      }
      if (!sourceExists(sourceId)) {
        pushMsg(out.errors, ruleId, p, 'Unknown sourceId "' + sourceId + '"');
        return false;
      }
      return true;
    }

    function warnKindIfNot(sourceId, expectedKinds, pfx) {
      var kind = getSourceKind(sourceId);
      if (!kind) return; // unknown kind = can’t advise
      var ok = false;
      for (var i = 0; i < expectedKinds.length; i++) if (kind === expectedKinds[i]) ok = true;
      if (!ok) {
        pushMsg(
          out.warnings,
          ruleId,
          pfx,
          'Source "' + sourceId + '" has kind "' + kind + '" but this reason typically expects ' + expectedKinds.join(' or ')
        );
      }
    }

    // Primitive reasons
    if (type === 'termHit') {
      if (!spec.source) pushMsg(out.errors, ruleId, path + '.source', 'termHit requires "source"');
      if (!spec.term) pushMsg(out.errors, ruleId, path + '.term', 'termHit requires "term"');

      if (spec.source && requireSource(path + '.source', spec.source)) {
        warnKindIfNot(spec.source, ['text'], path + '.source');
      }

      if (spec.mode && spec.mode !== 'contains' && spec.mode !== 'word') {
        pushMsg(out.warnings, ruleId, path + '.mode', 'Unknown mode "' + spec.mode + '" (expected "contains" or "word")');
      }

      // A.2: word-mode + multi-word term is suspicious
      if (str(spec.mode) === 'word' && looksMultiWord(spec.term)) {
        pushMsg(out.warnings, ruleId, path + '.term', 'mode:"word" with a multi-word term may never match as a single token');
      }

      return;
    }

    if (type === 'anyTerms' || type === 'allTerms') {
      if (!spec.source) pushMsg(out.errors, ruleId, path + '.source', type + ' requires "source"');

      if (spec.source && requireSource(path + '.source', spec.source)) {
        warnKindIfNot(spec.source, ['text'], path + '.source');
      }

      if (spec.terms == null) {
        pushMsg(out.errors, ruleId, path + '.terms', type + ' requires "terms"');
      } else {
        var terms = isArr(spec.terms) ? spec.terms : [spec.terms];
        var nonEmpty = 0;
        for (var j = 0; j < terms.length; j++) {
          if (typeof terms[j] !== 'string') pushMsg(out.errors, ruleId, path + '.terms[' + j + ']', 'terms must be strings');

          var cleaned = str(terms[j]).trim();
          if (cleaned) nonEmpty++;

          // A.2: word-mode + multi-word term warning
          if (str(spec.mode) === 'word' && looksMultiWord(cleaned)) {
            pushMsg(out.warnings, ruleId, path + '.terms[' + j + ']', 'mode:"word" with multi-word term may never match as a single token');
          }
        }
        if (nonEmpty === 0) pushMsg(out.errors, ruleId, path + '.terms', 'terms contains no usable strings');
      }

      if (spec.mode && spec.mode !== 'contains' && spec.mode !== 'word') {
        pushMsg(out.warnings, ruleId, path + '.mode', 'Unknown mode "' + spec.mode + '" (expected "contains" or "word")');
      }

      return;
    }

    if (type === 'phraseHit') {
      if (!spec.source) pushMsg(out.errors, ruleId, path + '.source', 'phraseHit requires "source"');
      if (!spec.phrase) pushMsg(out.errors, ruleId, path + '.phrase', 'phraseHit requires "phrase"');

      if (spec.source && requireSource(path + '.source', spec.source)) {
        warnKindIfNot(spec.source, ['text'], path + '.source');
      }

      // A.2: phraseHit on normalized sources is OK, but warn if phrase is empty after trim
      if (str(spec.phrase).trim() === '') {
        pushMsg(out.errors, ruleId, path + '.phrase', 'phrase is empty');
      }

      return;
    }

    if (type === 'regexHit') {
      if (!spec.source) pushMsg(out.errors, ruleId, path + '.source', 'regexHit requires "source"');
      if (!spec.pattern) pushMsg(out.errors, ruleId, path + '.pattern', 'regexHit requires "pattern"');

      if (spec.source && requireSource(path + '.source', spec.source)) {
        warnKindIfNot(spec.source, ['text'], path + '.source');
      }

      if (spec.flags && typeof spec.flags !== 'string') {
        pushMsg(out.warnings, ruleId, path + '.flags', 'flags should be a string');
      }

      return;
    }

    if (type === 'countInWindow') {
      if (!spec.source) pushMsg(out.errors, ruleId, path + '.source', 'countInWindow requires "source" (history list sourceId)');

      if (spec.source && requireSource(path + '.source', spec.source)) {
        // A.2: countInWindow expects a list source (history.*)
        warnKindIfNot(spec.source, ['list'], path + '.source');
      }

      if (spec.terms == null) {
        pushMsg(out.errors, ruleId, path + '.terms', 'countInWindow requires "terms"');
      } else {
        var t2 = isArr(spec.terms) ? spec.terms : [spec.terms];
        var anyOk = false;
        for (var k = 0; k < t2.length; k++) {
          if (typeof t2[k] !== 'string') pushMsg(out.errors, ruleId, path + '.terms[' + k + ']', 'terms must be strings');
          if (str(t2[k]).trim()) anyOk = true;

          if (str(spec.mode) === 'word' && looksMultiWord(t2[k])) {
            pushMsg(out.warnings, ruleId, path + '.terms[' + k + ']', 'mode:"word" with multi-word term may never match as a single token');
          }
        }
        if (!anyOk) pushMsg(out.errors, ruleId, path + '.terms', 'terms contains no usable strings');
      }

      if (spec.window != null && (isNaN(+spec.window) || +spec.window < 0)) pushMsg(out.errors, ruleId, path + '.window', 'window must be a number >= 0');
      if (spec.min != null && (isNaN(+spec.min) || +spec.min < 0)) pushMsg(out.errors, ruleId, path + '.min', 'min must be a number >= 0');

      if (spec.mode && spec.mode !== 'contains' && spec.mode !== 'word') {
        pushMsg(out.warnings, ruleId, path + '.mode', 'Unknown mode "' + spec.mode + '" (expected "contains" or "word")');
      }

      // A.2: min > window warning
      if (spec.window != null && spec.min != null) {
        var w = +spec.window, m = +spec.min;
        if (!isNaN(w) && !isNaN(m) && w >= 0 && m >= 0 && m > w) {
          pushMsg(out.warnings, ruleId, path, 'min (' + m + ') is greater than window (' + w + '); rule may never pass');
        }
      }

      return;
    }
  }

  DSLValidate.validateRule = function (ruleSpec) {
    var out = { errors: [], warnings: [] };
    ruleSpec = ruleSpec || {};

    var ruleId = str(ruleSpec.id);

    if (!ruleId) pushMsg(out.errors, ruleId, 'id', 'Rule requires "id" (stable unique key)');
    if (!ruleSpec.moduleId) pushMsg(out.errors, ruleId, 'moduleId', 'Rule requires "moduleId"');
    if (ruleSpec.priority != null && isNaN(+ruleSpec.priority)) pushMsg(out.errors, ruleId, 'priority', 'priority must be numeric');
    if (ruleSpec.targets != null && !isArr(ruleSpec.targets)) pushMsg(out.errors, ruleId, 'targets', 'targets must be an array of strings');

    // when
    if (!ruleSpec.when) pushMsg(out.errors, ruleId, 'when', 'Rule requires "when" reason spec');
    else validateReason(ruleId, ruleSpec.when, 'when', out);

    // targets warning (already had this)
    if (!ruleSpec.targets || !ruleSpec.targets.length) {
      pushMsg(out.warnings, ruleId, 'targets', 'No targets specified; conflict grouping will be limited');
    }

    // effects
    validateEffects(ruleId, ruleSpec.effects, ruleSpec.targets, out);

    // A.2: Rule does nothing warning
    // (We don’t compile commit yet, but rule authors may include it in specs already)
    var hasEffects = !!ruleSpec.effects;
    var hasCommit = !!ruleSpec.commit;
    if (!hasEffects && !hasCommit) {
      pushMsg(out.warnings, ruleId, '', 'Rule has no effects and no commit; it may have no impact even if it fires');
    }

    return out;
  };

  DSLValidate.validateRules = function (ruleSpecs) {
    var summary = { errors: [], warnings: [], byRule: {} };
    ruleSpecs = isArr(ruleSpecs) ? ruleSpecs : [];

    // duplicate ids
    var seen = {};
    for (var i = 0; i < ruleSpecs.length; i++) {
      var id = str(ruleSpecs[i] && ruleSpecs[i].id);
      if (id) {
        if (seen[id]) pushMsg(summary.errors, id, 'id', 'Duplicate rule id "' + id + '"');
        else seen[id] = true;
      }
    }

    for (i = 0; i < ruleSpecs.length; i++) {
      var r = ruleSpecs[i] || {};
      var rid = str(r.id);
      var res = DSLValidate.validateRule(r);
      summary.byRule[rid || ('(index ' + i + ')')] = res;

      var j;
      for (j = 0; j < res.errors.length; j++) summary.errors.push(res.errors[j]);
      for (j = 0; j < res.warnings.length; j++) summary.warnings.push(res.warnings[j]);
    }

    return summary;
  };

  root.DSLValidate = DSLValidate;

})(window);

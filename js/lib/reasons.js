/* ============================================================================
 * reasons.js — Reason Vocabulary (ES5)
 * ----------------------------------------------------------------------------
 * Provides standard reason primitives:
 *   - termHit, anyTerms, allTerms, phraseHit, regexHit
 *   - countInWindow
 *   - derivedCmp, stateCmp, range, exists, changedSince
 *   - cooldown, chance
 *   - and/or/not composition
 *
 * Each reason returns an object:
 *   { kind:String, ok:Boolean, meta:Object, children?:Array, child?:Object }
 * ============================================================================
 */
(function (root) {
  'use strict';

  var Reasons = {};

  // ---------------- utilities ----------------
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function str(x) { return x == null ? '' : String(x); }

  function cmp(a, op, b) {
    // Strict minimal operator set
    if (op === '==') return a == b; // intentional loose equality for strings/numbers
    if (op === '!=') return a != b;
    if (op === '>')  return a > b;
    if (op === '>=') return a >= b;
    if (op === '<')  return a < b;
    if (op === '<=') return a <= b;
    return false;
  }

  function getPath(obj, path) {
    // path like "tone.level" or "memory.facts.likes.tea"
    if (!path) return undefined;
    var parts = String(path).split('.');
    var cur = obj, i, p;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (!cur || !hasOwn(cur, p)) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function ensureReason(kind, ok, meta) {
    return { kind: kind, ok: !!ok, meta: meta || {} };
  }

  // ---------------- text helpers ----------------
  function containsWord(hay, needle) {
    // word boundary-ish without regex backtracking insanity
    // Assumes both are normalized (spaces)
    hay = ' ' + str(hay) + ' ';
    needle = ' ' + str(needle) + ' ';
    return hay.indexOf(needle) !== -1;
  }

  // ==========================================================================
  // Primitive Reason Builders
  // ==========================================================================

  // termHit: term in text
  Reasons.termHit = function (Sources, moduleId, sourceId, term, mode, ctx, state, derived, trace) {
    var txt = Sources.read(moduleId, sourceId, ctx, state, derived, { strict: false, trace: trace });
    txt = str(txt);

    term = str(term);
    mode = mode || 'contains'; // 'contains' or 'word'

    var found = false;
    if (mode === 'word') found = containsWord(txt, term);
    else found = (txt.indexOf(term) !== -1);

    return ensureReason('termHit', found, {
      sourceId: sourceId,
      term: term,
      mode: mode,
      found: found
    });
  };

  // anyTerms: any of list
  Reasons.anyTerms = function (Sources, moduleId, sourceId, terms, mode, ctx, state, derived, trace) {
    var txt = Sources.read(moduleId, sourceId, ctx, state, derived, { strict: false, trace: trace });
    txt = str(txt);

    terms = isArr(terms) ? terms : (terms == null ? [] : [terms]);
    mode = mode || 'contains';

    var hits = [], i, t, ok;
    for (i = 0; i < terms.length; i++) {
      t = str(terms[i]);
      if (!t) continue;
      ok = (mode === 'word') ? containsWord(txt, t) : (txt.indexOf(t) !== -1);
      if (ok) hits.push(t);
    }

    return ensureReason('anyTerms', hits.length > 0, {
      sourceId: sourceId,
      terms: terms.slice(0),
      mode: mode,
      hits: hits
    });
  };

  // allTerms: all of list
  Reasons.allTerms = function (Sources, moduleId, sourceId, terms, mode, ctx, state, derived, trace) {
    var txt = Sources.read(moduleId, sourceId, ctx, state, derived, { strict: false, trace: trace });
    txt = str(txt);

    terms = isArr(terms) ? terms : (terms == null ? [] : [terms]);
    mode = mode || 'contains';

    var missing = [], i, t, ok;
    for (i = 0; i < terms.length; i++) {
      t = str(terms[i]);
      if (!t) continue;
      ok = (mode === 'word') ? containsWord(txt, t) : (txt.indexOf(t) !== -1);
      if (!ok) missing.push(t);
    }

    return ensureReason('allTerms', missing.length === 0 && terms.length > 0, {
      sourceId: sourceId,
      terms: terms.slice(0),
      mode: mode,
      missing: missing
    });
  };

  // phraseHit: exact phrase (normalized or raw depending on source)
  Reasons.phraseHit = function (Sources, moduleId, sourceId, phrase, ctx, state, derived, trace) {
    var txt = Sources.read(moduleId, sourceId, ctx, state, derived, { strict: false, trace: trace });
    txt = str(txt);
    phrase = str(phrase);

    var idx = txt.indexOf(phrase);
    return ensureReason('phraseHit', idx !== -1 && phrase.length > 0, {
      sourceId: sourceId,
      phrase: phrase,
      index: idx
    });
  };

  // regexHit: advanced; ES5 RegExp
  Reasons.regexHit = function (Sources, moduleId, sourceId, pattern, flags, ctx, state, derived, trace) {
    var txt = Sources.read(moduleId, sourceId, ctx, state, derived, { strict: false, trace: trace });
    txt = str(txt);

    pattern = str(pattern);
    flags = str(flags);

    try {
      var re = new RegExp(pattern, flags);
      var m = re.exec(txt);
      return ensureReason('regexHit', !!m, {
        sourceId: sourceId,
        pattern: pattern,
        flags: flags,
        match: m ? m[0] : null
      });
    } catch (e) {
      return ensureReason('error', false, {
        message: 'Invalid regex',
        sourceId: sourceId,
        pattern: pattern,
        flags: flags,
        error: String(e && e.message ? e.message : e)
      });
    }
  };

  // countInWindow: count term hits across last N messages (history list source)
  Reasons.countInWindow = function (Sources, moduleId, historyListSourceId, terms, window, mode, min, ctx, state, derived, trace) {
    var arr = Sources.read(moduleId, historyListSourceId, ctx, state, derived, { strict: false, trace: trace });
    arr = isArr(arr) ? arr : [];
    terms = isArr(terms) ? terms : (terms == null ? [] : [terms]);
    window = +window || arr.length;
    if (window < 0) window = 0;
    if (window > arr.length) window = arr.length;
    mode = mode || 'contains';
    min = (min == null ? 1 : +min);

    var start = arr.length - window;
    var count = 0;
    var i, j, msg, t, ok;

    for (i = start; i < arr.length; i++) {
      msg = str(arr[i]);
      for (j = 0; j < terms.length; j++) {
        t = str(terms[j]);
        if (!t) continue;
        ok = (mode === 'word') ? containsWord(msg, t) : (msg.indexOf(t) !== -1);
        if (ok) { count++; break; } // count per-message hit once
      }
    }

    return ensureReason('countInWindow', count >= min, {
      sourceId: historyListSourceId,
      window: window,
      terms: terms.slice(0),
      mode: mode,
      count: count,
      min: min
    });
  };

  // derivedCmp: compare derived[key] to value
  Reasons.derivedCmp = function (key, op, value, derived) {
    var actual = (derived && hasOwn(derived, key)) ? derived[key] : undefined;
    return ensureReason('derivedCmp', cmp(actual, op, value), {
      key: key, op: op, value: value, actual: actual
    });
  };

  // stateCmp: compare state path to value
  Reasons.stateCmp = function (path, op, value, state) {
    var actual = getPath(state || {}, path);
    return ensureReason('stateCmp', cmp(actual, op, value), {
      path: path, op: op, value: value, actual: actual
    });
  };

  // range: numeric range check
  Reasons.range = function (pathOrKey, min, max, obj) {
    var actual = getPath(obj || {}, pathOrKey);
    var n = +actual;
    var ok = true;
    if (min != null) ok = ok && (n >= +min);
    if (max != null) ok = ok && (n <= +max);
    return ensureReason('range', ok, {
      key: pathOrKey, min: min, max: max, actual: actual
    });
  };

  // exists: state path exists and non-empty
  Reasons.exists = function (path, state) {
    var v = getPath(state || {}, path);
    var ok = !(v == null || v === '' || (isArr(v) && v.length === 0));
    return ensureReason('exists', ok, { path: path, valueType: (v === null ? 'null' : typeof v) });
  };

  // changedSince: compare prev snapshot vs current
  Reasons.changedSince = function (path, prevState, state) {
    var was = getPath(prevState || {}, path);
    var now = getPath(state || {}, path);
    var ok = (JSON.stringify(was) !== JSON.stringify(now));
    return ensureReason('changedSince', ok, { path: path, was: was, now: now });
  };

  // cooldown: prevent refire too often (uses state.turn or chat.messageCount as "now")
  Reasons.cooldown = function (key, cooldownTurns, now, state) {
    var last = getPath(state || {}, key);
    cooldownTurns = +cooldownTurns || 0;
    now = +now || 0;
    var ok = (last == null) ? true : ((now - (+last)) >= cooldownTurns);
    return ensureReason('cooldown', ok, { key: key, cooldownTurns: cooldownTurns, last: last, now: now });
  };

  // chance: RNG roll with optional deterministic source (caller supplies roll)
  Reasons.chance = function (p, roll) {
    p = +p; if (isNaN(p)) p = 0;
    roll = +roll; if (isNaN(roll)) roll = Math.random();
    var ok = roll < p;
    return ensureReason('chance', ok, { p: p, roll: roll });
  };

  // ==========================================================================
  // Boolean composition
  // ==========================================================================

  Reasons.AND = function (children) {
    children = isArr(children) ? children : (children ? [children] : []);
    var i, ok = true;
    for (i = 0; i < children.length; i++) ok = ok && !!(children[i] && children[i].ok);
    return { kind: 'and', ok: ok, meta: {}, children: children };
  };

  Reasons.OR = function (children) {
    children = isArr(children) ? children : (children ? [children] : []);
    var i, ok = false;
    for (i = 0; i < children.length; i++) ok = ok || !!(children[i] && children[i].ok);
    return { kind: 'or', ok: ok, meta: {}, children: children };
  };

  Reasons.NOT = function (child) {
    var ok = !(child && child.ok);
    return { kind: 'not', ok: ok, meta: {}, child: child || null };
  };

  root.Reasons = Reasons;

})(window);

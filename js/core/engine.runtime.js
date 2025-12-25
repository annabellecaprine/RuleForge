/* engine.runtime.js — ES5, no DOM
 * Purpose:
 * - Progressive evaluation: apply effects as each rule fires
 * - Hard-block writes outside allowed targets
 * - Patch-based writes (ruleSpec.write)
 *
 * Exposes: window.EngineRuntime
 */
(function (root) {
  'use strict';

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function ensureDevCtxShape(ctx) {
    ctx = ctx || {};
    if (!ctx.context) ctx.context = {};
    if (!ctx.context.chat) ctx.context.chat = {};
    if (!ctx.context.character) ctx.context.character = {};
    if (!ctx.chat) ctx.chat = ctx.context.chat;
    if (!ctx.character) ctx.character = ctx.context.character;
    return ctx;
  }

  function getByDotPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function setByDotPath(obj, path, val) {
    if (!obj || !path) return;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      if (i === parts.length - 1) {
        cur[p] = val;
        return;
      }
      if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
  }

  function normalizeAllowedTargets(allowed) {
    var out = {};
    if (allowed && typeof allowed === 'object') {
      for (var k in allowed) if (hasOwn(allowed, k)) out[String(k)] = !!allowed[k];
    }
    return out;
  }

  function hardBlockIfNotAllowed(path, allowedTargets) {
    if (!allowedTargets || !allowedTargets[path]) {
      return { ok: false, error: 'Write target not allowed: ' + String(path) };
    }
    return { ok: true };
  }

  function applyPatch(ctx, patch, allowedTargets) {
    // patch shape:
    // { op:'append'|'set', path:'context.character.scenario', value:'...' }
    // also supports { targetId, text, mode } (legacy-friendly)
    ctx = ensureDevCtxShape(ctx);

    if (!patch || typeof patch !== 'object') return { ok: true };

    var path = patch.path || patch.targetId;
    if (!path) return { ok: true };

    path = String(path);

    var ok = hardBlockIfNotAllowed(path, allowedTargets);
    if (!ok.ok) return ok;

    var op = patch.op || patch.mode || 'append';
    op = String(op);

    var val = patch.value;
    if (val == null && patch.text != null) val = patch.text;
    if (val == null) val = '';

    if (op === 'set') {
      setByDotPath(ctx, path, String(val));
      return { ok: true };
    }

    // default: append
    var cur = getByDotPath(ctx, path);
    var base = (cur == null) ? '' : String(cur);
    var add = String(val);
    if (!add) return { ok: true };

    var next = base ? (base + '\n\n' + add) : add;
    setByDotPath(ctx, path, next);
    return { ok: true };
  }

  function applyEffectsObject(ctx, effectsObj, allowedTargets) {
    // Effects are unknown format; we support the common “map of target -> string|[string]” case.
    // Anything else is ignored (but you can tighten later once you inspect real effects).
    if (!effectsObj || typeof effectsObj !== 'object') return { ok: true };

    for (var k in effectsObj) if (hasOwn(effectsObj, k)) {
      var path = String(k);
      var ok = hardBlockIfNotAllowed(path, allowedTargets);
      if (!ok.ok) return ok;

      var v = effectsObj[k];
      if (v == null) continue;

      if (isArr(v)) {
        for (var i = 0; i < v.length; i++) {
          var r1 = applyPatch(ctx, { op: 'append', path: path, value: v[i] }, allowedTargets);
          if (!r1.ok) return r1;
        }
      } else {
        var r2 = applyPatch(ctx, { op: 'append', path: path, value: v }, allowedTargets);
        if (!r2.ok) return r2;
      }
    }
    return { ok: true };
  }

  function indexRuleSpecsById(ruleSpecs) {
    var map = {};
    if (!isArr(ruleSpecs)) return map;
    for (var i = 0; i < ruleSpecs.length; i++) {
      var rs = ruleSpecs[i];
      if (!rs) continue;
      if (rs.id == null) continue;
      map[String(rs.id)] = rs;
    }
    return map;
  }

  function stableSortByPriorityDesc(rules) {
    if (!isArr(rules)) return [];
    for (var i = 0; i < rules.length; i++) rules[i].__idx = i;
    rules.sort(function (a, b) {
      var ap = (a && typeof a.priority === 'number') ? a.priority : 0;
      var bp = (b && typeof b.priority === 'number') ? b.priority : 0;
      if (bp !== ap) return bp - ap;
      var ai = (a && typeof a.__idx === 'number') ? a.__idx : 0;
      var bi = (b && typeof b.__idx === 'number') ? b.__idx : 0;
      return ai - bi;
    });
    for (i = 0; i < rules.length; i++) try { delete rules[i].__idx; } catch (_e) { }
    return rules;
  }

  function mergeEffectsInto(acc, effectsObj) {
    if (!effectsObj || typeof effectsObj !== 'object') return acc || {};
    acc = acc || {};
    for (var k in effectsObj) if (hasOwn(effectsObj, k)) {
      var v = effectsObj[k];
      if (v == null) continue;
      if (!acc[k]) acc[k] = [];
      if (isArr(v)) {
        for (var i = 0; i < v.length; i++) acc[k].push(String(v[i]));
      } else {
        acc[k].push(String(v));
      }
    }
    return acc;
  }

  function runRulesProgressive(compiledRules, ruleSpecs, ctx, opts) {
    opts = opts || {};
    var allowedTargets = normalizeAllowedTargets(opts.allowedTargets || {});
    ctx = ensureDevCtxShape(ctx);

    if (!root.EvalCore || !root.EvalCore.runRules) {
      return { ok: false, hardError: 'Missing EvalCore.runRules', ctx: ctx };
    }

    compiledRules = stableSortByPriorityDesc(isArr(compiledRules) ? compiledRules.slice() : []);
    var specById = indexRuleSpecsById(ruleSpecs);

    var state = {};
    var derived = {};
    var trace = [];

    var fired = [];
    var conflicts = [];
    var effectsMerged = {};

    for (var i = 0; i < compiledRules.length; i++) {
      var rule = compiledRules[i];
      if (!rule) continue;

      var report;
      try {
        report = root.EvalCore.runRules([rule], {
          ctx: ctx,
          state: state,
          derived: derived,
          trace: trace
        });
      } catch (e) {
        return {
          ok: false,
          hardError: 'EvalCore.runRules threw: ' + String(e && e.message ? e.message : e),
          ctx: ctx
        };
      }

      var didFire = report && report.fired && report.fired.length;
      if (didFire) {
        for (var f = 0; f < report.fired.length; f++) fired.push(report.fired[f]);
      }
      if (report && report.conflicts && report.conflicts.length) {
        for (var c = 0; c < report.conflicts.length; c++) conflicts.push(report.conflicts[c]);
      }

      // 1) Apply DSL engine effects immediately (unknown-but-common shape supported)
      if (didFire && report && report.effects) {
        effectsMerged = mergeEffectsInto(effectsMerged, report.effects);

        var er = applyEffectsObject(ctx, report.effects, allowedTargets);
        if (!er.ok) {
          return {
            ok: false,
            hardError: er.error,
            fired: fired,
            conflicts: conflicts,
            effects: effectsMerged,
            ctx: ctx
          };
        }
      }

      // 2) Apply ruleSpec.patch immediately (your requested “Patch” flow)
      if (didFire && rule && rule.id != null) {
        var rs = specById[String(rule.id)];
        if (rs && rs.write && (rs.write.path || rs.write.targetId)) {
          // normalize to patch
          var patch = {
            op: rs.write.op || rs.write.mode || 'append',
            path: rs.write.path || rs.write.targetId,
            value: (rs.write.value != null ? rs.write.value : rs.write.text)
          };

          var pr = applyPatch(ctx, patch, allowedTargets);
          if (!pr.ok) {
            return {
              ok: false,
              hardError: pr.error,
              fired: fired,
              conflicts: conflicts,
              effects: effectsMerged,
              ctx: ctx
            };
          }

          // also reflect patch into merged effects for display
          effectsMerged = mergeEffectsInto(effectsMerged, (function () {
            var o = {}; o[String(patch.path)] = [String(patch.value == null ? '' : patch.value)]; return o;
          })());
        }
      }
    }

    return {
      ok: true,
      fired: fired,
      conflicts: conflicts,
      effects: effectsMerged,
      ctx: ctx,
      trace: trace
    };
  }

  /* =====================================================================
   * Package/Script Builder (NEW, PURE, ES5, NO DOM)
   * - SiteBuilder X will import the package object (blocks + metadata).
   * - Basic Engine panel will display ONLY the rendered script string.
   * ===================================================================== */

  function normalizeBuildOrder(order, fallbackOrder) {
    // Keeps given order as-is, but removes dupes and appends missing fallback items.
    var out = [];
    var seen = {};
    var i, id;

    if (isArr(order)) {
      for (i = 0; i < order.length; i++) {
        id = String(order[i]);
        if (!id || seen[id]) continue;
        out.push(id);
        seen[id] = true;
      }
    }

    if (isArr(fallbackOrder)) {
      for (i = 0; i < fallbackOrder.length; i++) {
        id = String(fallbackOrder[i]);
        if (!id || seen[id]) continue;
        out.push(id);
        seen[id] = true;
      }
    }

    return out;
  }

  function getPanelDef(id) {
    var P = root.Panels;
    if (!P || !id) return null;

    // mirror engine.panel.js resolver patterns (no DOM, just data)
    try { if (P.byId && P.byId[id]) return P.byId[id]; } catch (_e0) { }
    try {
      if (typeof P.get === 'function') {
        var d = P.get(id);
        if (d) return d;
      }
    } catch (_e1) { }
    try { if (P._defs && P._defs[id]) return P._defs[id]; } catch (_e2) { }
    try { if (P.defs && P.defs[id]) return P.defs[id]; } catch (_e3) { }
    try { if (P.registry && P.registry[id]) return P.registry[id]; } catch (_e4) { }

    var arr = null;
    try { if (isArr(P.list)) arr = P.list; } catch (_e5) { }
    if (!arr) { try { if (isArr(P.panels)) arr = P.panels; } catch (_e6) { } }
    if (!arr) { try { if (isArr(P.items)) arr = P.items; } catch (_e7) { } }

    if (arr) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === id) return arr[i];
      }
    }

    try { if (P[id]) return P[id]; } catch (_e8) { }
    return null;
  }

  function isPanelEnabled(studioState, id) {
    var p = studioState && studioState.panels ? studioState.panels[id] : null;
    return !!(p && p.enabled);
  }

  function collectExportBlocks(studioState, opts) {
    opts = opts || {};
    studioState = studioState || {};

    var order = normalizeBuildOrder(opts.buildOrder || [], opts.fallbackOrder || []);
    var blocks = [];

    for (var i = 0; i < order.length; i++) {
      var id = String(order[i]);
      if (!id) continue;
      if (!isPanelEnabled(studioState, id)) continue;

      var def = getPanelDef(id);
      if (!def || typeof def.getExportBlocks !== 'function') continue;

      var arr;
      try { arr = def.getExportBlocks(studioState) || []; } catch (_e0) { arr = []; }
      if (!isArr(arr)) arr = [];

      for (var j = 0; j < arr.length; j++) {
        var b = arr[j];
        if (!b) continue;

        blocks.push({
          moduleId: id,
          id: b.id || (id + '.block.' + j),
          kind: b.kind || 'script',
          // keep code as string; SiteBuilder X will edit per-block later
          code: String(b.code || ''),
          // optional metadata (safe to ignore)
          title: b.title || ''
        });
      }
    }

    return { order: order, blocks: blocks };
  }

  // Advanced-only block collection (uses SBX compiler, not basic panel exports)
  function collectAdvancedBlocks(studioState, opts) {
    opts = opts || {};
    studioState = studioState || {};

    // Get SBX data (Advanced only)
    var sbxData = (studioState.data && studioState.data.sbx) ? studioState.data.sbx : {};
    var sbxModules = sbxData.modules || {};
    var globalLists = (sbxData.lists && isArr(sbxData.lists)) ? sbxData.lists : [];

    var order = normalizeBuildOrder(opts.buildOrder || [], opts.fallbackOrder || []);
    var blocks = [];

    // Require SBX compiler
    if (!root.SBX || !root.SBX.compiler || typeof root.SBX.compiler.generate !== 'function') {
      // No Advanced compiler available - return empty
      return { order: order, blocks: [] };
    }

    for (var i = 0; i < order.length; i++) {
      var moduleId = String(order[i]);
      if (!moduleId) continue;

      // Check if module exists in SBX data
      var modData = sbxModules[moduleId];
      if (!modData || !modData.appState) continue;

      var appState = modData.appState || {};

      // Skip empty modules (no blocks)
      var modBlocks = (appState.blocks && isArr(appState.blocks)) ? appState.blocks : [];
      if (!modBlocks.length) continue;

      // Compile using SBX compiler
      var compiledCode = '';
      try {
        compiledCode = root.SBX.compiler.generate({
          lists: globalLists,  // Global lists
          derived: (appState.derived && isArr(appState.derived)) ? appState.derived : [],
          blocks: modBlocks
        });
      } catch (e) {
        // Compilation error - skip this module
        continue;
      }

      if (!compiledCode) continue;

      blocks.push({
        moduleId: moduleId,
        id: moduleId + '.compiled',
        kind: 'script',
        code: String(compiledCode),
        title: (modData.label || moduleId)
      });
    }

    return { order: order, blocks: blocks };
  }

  function buildPackage(studioState, opts) {
    opts = opts || {};
    studioState = studioState || {};

    var ce = collectExportBlocks(studioState, opts);
    var order = ce.order;
    var blocks = ce.blocks;

    return {
      schema: 'studio.package',
      version: '0.1.0',
      meta: {
        exportedAt: (new Date()).toISOString()
      },
      buildOrder: order.slice(0),
      blocks: blocks
    };
  }

  function renderAdvancedScript(pkg, opts) {
    // IMPORTANT: This is the copy/paste string for JanitorAI Advanced Script.
    // NO header. NO embedded JSON manifest.
    opts = opts || {};
    pkg = pkg || {};
    var blocks = (pkg.blocks && isArr(pkg.blocks)) ? pkg.blocks : [];
    if (!blocks.length) return '';

    var withSeparators = (opts.withSeparators !== false); // default true
    var out = '';

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b) continue;

      var code = (b.code == null) ? '' : String(b.code);

      if (withSeparators) {
        out += '// ============================================================\n';
        out += '// ' + String(b.moduleId || '') + ' — ' + String(b.id || '') + '\n';
        out += '// ============================================================\n';
      }

      out += code;
      if (out.charAt(out.length - 1) !== '\n') out += '\n';
      out += '\n';
    }

    return out;
  }

  function buildAdvancedScript(studioState, opts) {
    // Use Advanced-specific collection (SBX modules only)
    var ce = collectAdvancedBlocks(studioState, opts);
    var pkg = {
      schema: 'studio.package',
      version: '0.1.0',
      meta: { exportedAt: (new Date()).toISOString() },
      buildOrder: ce.order,
      blocks: ce.blocks
    };
    return renderAdvancedScript(pkg, opts);
  }

  // preserve existing exports, add new ones (no breaking changes)
  root.EngineRuntime = {
    ensureDevCtxShape: ensureDevCtxShape,
    getByDotPath: getByDotPath,
    setByDotPath: setByDotPath,
    applyPatch: applyPatch,
    applyEffectsObject: applyEffectsObject,
    runRulesProgressive: runRulesProgressive,

    // NEW
    collectExportBlocks: collectExportBlocks,
    buildPackage: buildPackage,
    renderAdvancedScript: renderAdvancedScript,
    buildAdvancedScript: buildAdvancedScript
  };

})(window);

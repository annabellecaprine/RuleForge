(function (root) {
  'use strict';

  if (!root.Panels || !root.Panels.register) {
    throw new Error('engine.panel.js requires panels.registry.js loaded first');
  }

  // ---------- Helpers ----------
  function $(id) { return document.getElementById(id); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (_e) { }
  }

  function esc(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Our canonical module list for build/eval order (tabs never reorder)
  // Keep in sync with ui.shell.js PANELS list (excluding engine).
  var MODULES = [
    { id: 'lorebook', label: 'Lorebook' },
    { id: 'voices', label: 'Voices' },
    { id: 'memory', label: 'Memory' },
    { id: 'events', label: 'Events' },
    { id: 'tone', label: 'Tone' },
    { id: 'ambient', label: 'Ambient' },
    { id: 'random', label: 'Random' },
    { id: 'conditionCombiner', label: 'Condition Combiner' },
    { id: 'scoring', label: 'Scoring' }
  ];

  function defaultOrder() {
    var out = [];
    for (var i = 0; i < MODULES.length; i++) out.push(MODULES[i].id);
    return out;
  }

  function normalizeOrder(order) {
    // Ensure: contains each module exactly once, no extras.
    var want = {};
    for (var i = 0; i < MODULES.length; i++) want[MODULES[i].id] = true;

    var out = [];
    var seen = {};

    if (isArr(order)) {
      for (i = 0; i < order.length; i++) {
        var id = String(order[i]);
        if (want[id] && !seen[id]) {
          out.push(id);
          seen[id] = true;
        }
      }
    }

    for (i = 0; i < MODULES.length; i++) {
      var mid = MODULES[i].id;
      if (!seen[mid]) out.push(mid);
    }

    return out;
  }

  function loadBuildOrder() {
    var raw = lsGet('studio.buildOrder', '');
    if (!raw) return defaultOrder();
    try { return normalizeOrder(JSON.parse(raw)); }
    catch (_e) { return defaultOrder(); }
  }

  function saveBuildOrder(order) {
    lsSet('studio.buildOrder', JSON.stringify(normalizeOrder(order)));
  }

  function moveItem(order, idx, dir) {
    var j = idx + dir;
    if (j < 0 || j >= order.length) return order;
    var tmp = order[idx];
    order[idx] = order[j];
    order[j] = tmp;
    return order;
  }

  function moduleLabel(id) {
    for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i].label;
    return id;
  }

  function getPanelState(studioState, id) {
    return studioState && studioState.panels ? studioState.panels[id] : null;
  }

  function isEnabled(studioState, id) {
    var p = getPanelState(studioState, id);
    return !!(p && p.enabled);
  }

  function getPriority(studioState, id) {
    var p = getPanelState(studioState, id);
    var v = p && typeof p.priority === 'number' ? p.priority : 0;
    if (isNaN(v)) v = 0;
    return v;
  }

  function setPriority(studioState, id, v) {
    if (!studioState || !studioState.panels || !studioState.panels[id]) return;
    studioState.panels[id].priority = v;

    // ui.shell.js persists studio.panels; mirror it here
    try { lsSet('studio.panels', JSON.stringify(studioState.panels)); } catch (_e) { }
  }

  /* ============================================================
   * Panel Definition Resolver
   * ============================================================ */
  function getPanelDef(id) {
    var P = root.Panels;
    if (!P) return null;

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

  // ============================================================
  // Canonical write targets (dev contract)
  // ============================================================
  var ALLOWED_WRITE_TARGETS = {
    'context.character.example_dialogs': true,
    'context.character.personality': true,
    'context.character.scenario': true
  };

  function collectWriteTargetsWithViolations(studioState, order) {
    var map = {};        // target -> [moduleId...]
    var violations = []; // { moduleId, target }

    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      if (!isEnabled(studioState, id)) continue;

      var def = getPanelDef(id);
      if (!def || !def.getWriteTargets) continue;

      var targets;
      try { targets = def.getWriteTargets(studioState); }
      catch (_e) { targets = null; }

      if (!targets || !targets.length) continue;

      for (var j = 0; j < targets.length; j++) {
        var t = String(targets[j]);

        if (!map[t]) map[t] = [];
        map[t].push(id);

        if (!ALLOWED_WRITE_TARGETS[t]) {
          violations.push({ moduleId: id, target: t });
        }
      }
    }

    return { map: map, violations: violations };
  }

  function renderWriteViolationsBlock(violations) {
    var html = '';
    html += '<div class="eng-block">';
    html += '<div class="eng-h">Write Contract Violations</div>';
    html += '<div class="eng-muted">Hard errors. These modules claim to write outside the allowed server targets.</div>';

    if (!violations || !violations.length) {
      html += '<div class="eng-muted">(none)</div>';
      html += '</div>';
      return html;
    }

    html += '<ul class="eng-ul">';
    for (var i = 0; i < violations.length; i++) {
      var v = violations[i];
      html += '<li><b>' + esc(moduleLabel(v.moduleId)) + '</b> writes <code>' + esc(v.target) + '</code></li>';
    }
    html += '</ul>';
    html += '</div>';
    return html;
  }

  function collectWriteTargets(studioState, order) {
    var map = {}; // target -> [moduleId...]
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      if (!isEnabled(studioState, id)) continue;

      var def = getPanelDef(id);
      if (!def || !def.getWriteTargets) continue;

      var targets;
      try { targets = def.getWriteTargets(studioState); }
      catch (_e) { targets = null; }

      if (!targets || !targets.length) continue;

      for (var j = 0; j < targets.length; j++) {
        var t = String(targets[j]);
        if (!map[t]) map[t] = [];
        map[t].push(id);
      }
    }
    return map;
  }

  function summarizeWriteConflicts(map) {
    var out = [];
    if (!map) return out;
    for (var k in map) {
      if (!hasOwn(map, k)) continue;
      if (map[k] && map[k].length > 1) {
        var names = [];
        for (var i = 0; i < map[k].length; i++) names.push(moduleLabel(map[k][i]));
        out.push(k + ' ← ' + names.join(', '));
      }
    }
    return out;
  }

  function renderWriteTargetBlock(writeMap) {
    var conflicts = summarizeWriteConflicts(writeMap);

    var html = '';
    html += '<div class="eng-block">';
    html += '<div class="eng-h">Write Target Conflicts</div>';
    html += '<div class="eng-muted">Warns when multiple enabled modules write the same context field. Human review cue.</div>';

    if (!conflicts.length) {
      html += '<div class="eng-muted">(none)</div>';
      html += '</div>';
      return html;
    }

    html += '<ul class="eng-ul">';
    for (var i = 0; i < conflicts.length; i++) {
      html += '<li>' + esc(conflicts[i]) + '</li>';
    }
    html += '</ul>';
    html += '</div>';
    return html;
  }

  // ---------- Rule collection contract ----------
  function collectRuleSpecs(studioState, order, diagOut) {
    var all = [];
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      if (!isEnabled(studioState, id)) continue;

      var def = getPanelDef(id);
      if (!def || !def.getRuleSpecs) {
        if (diagOut && diagOut.missing) diagOut.missing.push(id);
        continue;
      }

      try {
        var specs = def.getRuleSpecs(studioState);
        if (isArr(specs)) {
          for (var j = 0; j < specs.length; j++) {
            if (specs[j] && !specs[j].moduleId) specs[j].moduleId = id;
            all.push(specs[j]);
          }
        }
      } catch (e) {
        if (diagOut && diagOut.errors) {
          diagOut.errors.push({ moduleId: id, message: String(e && e.message ? e.message : e) });
        }
      }
    }
    return all;
  }

  // ---------- Render helpers ----------
  function renderPills(items) {
    var html = '<div class="eng-row">';
    for (var i = 0; i < items.length; i++) html += items[i];
    html += '</div>';
    return html;
  }

  function renderList(items, title) {
    var html = '';
    html += '<div class="eng-block">';
    html += '<div class="eng-h">' + esc(title) + '</div>';
    if (!items || !items.length) {
      html += '<div class="eng-muted">(none)</div>';
    } else {
      html += '<ul class="eng-ul">';
      for (var i = 0; i < items.length; i++) {
        html += '<li>' + esc(items[i]) + '</li>';
      }
      html += '</ul>';
    }
    html += '</div>';
    return html;
  }

  function renderDiag(diag) {
    var errs = diag && diag.errors ? diag.errors : [];
    var warns = diag && diag.warnings ? diag.warnings : [];

    var html = '';
    html += '<div class="eng-block">';
    html += '<div class="eng-h">Validation</div>';

    html += renderPills([
      '<span class="pill pill-err">Errors: ' + (errs.length || 0) + '</span>',
      '<span class="pill pill-warn">Warnings: ' + (warns.length || 0) + '</span>'
    ]);

    if (errs.length) {
      html += '<div class="eng-sub">Errors</div><ul class="eng-ul">';
      for (var i = 0; i < errs.length; i++) {
        var e = errs[i];
        html += '<li><b>' + esc(e.ruleId || '') + '</b> ' + esc(e.path || '') + ' — ' + esc(e.message || '') + '</li>';
      }
      html += '</ul>';
    }

    if (warns.length) {
      html += '<div class="eng-sub">Warnings</div><ul class="eng-ul">';
      for (var j = 0; j < warns.length; j++) {
        var w = warns[j];
        html += '<li><b>' + esc(w.ruleId || '') + '</b> ' + esc(w.path || '') + ' — ' + esc(w.message || '') + '</li>';
      }
      html += '</ul>';
    }

    html += '</div>';
    return html;
  }

  function renderEffects(effects) {
    var html = '<div class="eng-block"><div class="eng-h">Effects</div>';
    if (!effects) {
      html += '<div class="eng-muted">(none)</div></div>';
      return html;
    }

    var keys = [];
    for (var k in effects) if (hasOwn(effects, k)) keys.push(k);
    keys.sort();

    if (!keys.length) {
      html += '<div class="eng-muted">(none)</div></div>';
      return html;
    }

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var v = effects[key];
      html += '<div class="eng-sub">' + esc(key) + '</div>';
      if (isArr(v)) {
        html += '<ul class="eng-ul">';
        for (var j = 0; j < v.length; j++) html += '<li>' + esc(v[j]) + '</li>';
        html += '</ul>';
      } else {
        html += '<div class="eng-muted">' + esc(String(v)) + '</div>';
      }
    }

    html += '</div>';
    return html;
  }

  function summarizeConflicts(conflicts) {
    if (!conflicts || !conflicts.length) return [];
    var out = [];
    for (var i = 0; i < conflicts.length; i++) {
      var c = conflicts[i];
      if (c && c.target && c.ruleIds) {
        out.push(String(c.target) + ': ' + String(c.ruleIds.join(', ')));
      } else {
        out.push(JSON.stringify(c));
      }
    }
    return out;
  }

  // ---------- Panel UI ----------
  root.Panels.register({
    id: 'engine',

    mount: function (rootEl, studioState) {
      var order = loadBuildOrder();

      rootEl.innerHTML =
        '<div class="engine-panel">' +
        '<div class="engine-grid">' +

        '<div class="engine-col">' +

        '<div class="eng-block">' +
        '<div class="eng-h">Build Summary</div>' +
        '<div id="eng-summary" class="eng-muted"></div>' +
        '</div>' +

        '<div class="eng-block">' +
        '<div class="eng-h">Build Order</div>' +
        '<div class="eng-muted">Controls evaluation/export priority. Tabs never reorder. OFF modules stay in the list and can still be reordered.</div>' +
        '<div id="eng-order"></div>' +
        '<div class="eng-row">' +
        '<button class="btn btn-ghost" type="button" id="eng-normalize">Normalize priorities to this order</button>' +
        '<button class="btn btn-ghost" type="button" id="eng-reset-order">Reset Order</button>' +
        '</div>' +
        '</div>' +

        '<div class="eng-block">' +
        '<div class="eng-h">Simulator (Basic)</div>' +
        '<div class="eng-muted">Minimal simulation for basic rule testing. Deeper multi-message simulation belongs in Advanced.</div>' +

        '<div class="eng-form">' +
        '<label class="eng-lab">Scenario</label>' +
        '<input class="inp" id="eng-scenario" type="text" placeholder="e.g. Cafe AU" />' +

        '<label class="eng-lab">Personality</label>' +
        '<textarea class="inp eng-ta" id="eng-personality" rows="3" placeholder="A short personality summary..."></textarea>' +

        '<label class="eng-lab">User last message</label>' +
        '<textarea class="inp eng-ta" id="eng-lastmsg" rows="3" placeholder="Type a sample user message..."></textarea>' +

        '<label class="eng-lab">Message count</label>' +
        '<input class="inp inp-num" id="eng-msgcount" type="number" min="0" step="1" />' +
        '</div>' +

        '<div class="eng-row">' +
        '<button class="btn" type="button" id="eng-run">Run Evaluator</button>' +
        '<button class="btn btn-ghost" type="button" id="eng-validate">Validate Only</button>' +
        '</div>' +
        '</div>' +

        '</div>' +

        '<div class="engine-col">' +
        '<div class="eng-block">' +
        '<div class="eng-h">Results</div>' +
        '<div id="eng-results" class="eng-results"></div>' +
        '</div>' +

        '<div class="eng-block">' +
        '<div class="eng-h">Export Preview (ordered)</div>' +
        '<div class="eng-muted">Live preview built from the Package IR pipeline. This is what SiteBuilder X will import later.</div>' +
        '<div class="eng-row">' +
        '<button class="btn btn-ghost" type="button" id="eng-copy-code">Copy</button>' +
        '<button class="btn btn-ghost" type="button" id="eng-dl-package">Download Package</button>' +
        '</div>' +
        '<textarea class="inp eng-ta" id="eng-code" rows="14" readonly></textarea>' +
        '</div>' +
        '</div>' +

        '</div>' +
        '</div>';

      injectEngineCssOnce();
      seedFromSim();
      wireCodeViewer();
      renderOrderAndSummary();

      $('eng-reset-order').onclick = function () {
        order = defaultOrder();
        saveBuildOrder(order);
        renderOrderAndSummary();
      };

      $('eng-normalize').onclick = function () {
        var base = 80;
        var step = 10;
        for (var i = 0; i < order.length; i++) {
          var id = order[i];
          setPriority(studioState, id, base - (i * step));
        }
        renderOrderAndSummary();
      };

      $('eng-validate').onclick = function () { runPipeline(false); };
      $('eng-run').onclick = function () { runPipeline(true); };

      function renderOrderAndSummary() {
        order = normalizeOrder(order);
        saveBuildOrder(order);
        renderOrder();
        renderSummary();
        updateCodeViewer();
      }

      function renderSummary() {
        var host = $('eng-summary');
        if (!host) return;

        var enabled = 0, disabled = 0;
        for (var i = 0; i < order.length; i++) {
          if (isEnabled(studioState, order[i])) enabled++;
          else disabled++;
        }

        var eff = [];
        for (i = 0; i < order.length; i++) {
          if (isEnabled(studioState, order[i])) eff.push(moduleLabel(order[i]));
        }

        var wt = collectWriteTargetsWithViolations(studioState, order);
        var wmap = wt.map;
        var wconf = summarizeWriteConflicts(wmap);

        var html = '';
        html += renderPills([
          '<span class="pill pill-ok">Enabled: ' + enabled + '</span>',
          '<span class="pill pill-err">Disabled: ' + disabled + '</span>',
          '<span class="pill pill-warn">Total: ' + order.length + '</span>',
          '<span class="pill pill-warn">Write conflicts: ' + (wconf.length || 0) + '</span>'
        ]);
        html += '<div class="eng-divider"></div>';
        html += '<div class="eng-muted"><b>Effective order (enabled only):</b> ' + esc(eff.join(' → ') || '(none)') + '</div>';

        host.innerHTML = html;
      }

      function renderOrder() {
        var host = $('eng-order');
        if (!host) return;

        var html = '<div class="eng-order">';
        for (var i = 0; i < order.length; i++) {
          var id = order[i];
          var on = isEnabled(studioState, id);
          var pr = getPriority(studioState, id);

          html +=
            '<div class="eng-order-row' + (on ? '' : ' is-off') + '">' +
            '<div class="eng-order-left">' +
            '<span class="eng-order-name">' + esc(moduleLabel(id)) + '</span>' +
            '<span class="eng-order-id">(' + esc(id) + ')</span>' +
            '<span class="eng-order-dot ' + (on ? 'on' : 'off') + '"></span>' +
            '<span class="eng-order-state">' + (on ? 'ON' : 'OFF') + '</span>' +
            '<span class="eng-order-pr">prio ' + esc(String(pr)) + '</span>' +
            '</div>' +
            '<div class="eng-order-right">' +
            '<button class="btn btn-ghost eng-mini" data-move="up" data-idx="' + i + '" type="button">↑</button>' +
            '<button class="btn btn-ghost eng-mini" data-move="down" data-idx="' + i + '" type="button">↓</button>' +
            '</div>' +
            '</div>';
        }
        html += '</div>';
        host.innerHTML = html;

        var btns = host.getElementsByTagName('button');
        for (var j = 0; j < btns.length; j++) {
          btns[j].onclick = function () {
            var idx = parseInt(this.getAttribute('data-idx'), 10);
            var mv = this.getAttribute('data-move');
            if (isNaN(idx)) return;
            if (mv === 'up') moveItem(order, idx, -1);
            else moveItem(order, idx, +1);
            saveBuildOrder(order);
            renderOrderAndSummary();
          };
        }
      }

      function seedFromSim() {
        if (!root.Sim || !root.Sim.getCtx) return;

        var ctx = root.Sim.getCtx();
        try {
          var scenario = ctx && ctx.character ? (ctx.character.scenario || '') : '';
          var personality = ctx && ctx.character ? (ctx.character.personality || '') : '';
          var mc = ctx && ctx.chat ? (ctx.chat.message_count || 0) : 0;

          var last = '';
          if (ctx && ctx.chat && typeof ctx.chat.last_message === 'string') last = ctx.chat.last_message;

          var sEl = $('eng-scenario'); if (sEl) sEl.value = scenario;
          var pEl = $('eng-personality'); if (pEl) pEl.value = personality;
          var mEl = $('eng-msgcount'); if (mEl) mEl.value = mc;
          var lEl = $('eng-lastmsg'); if (lEl) lEl.value = last;
        } catch (_e) { }
      }

      function pushIntoSim() {
        if (!root.Sim) return;

        var sEl = $('eng-scenario');
        var pEl = $('eng-personality');
        var lEl = $('eng-lastmsg');
        var mEl = $('eng-msgcount');

        var scenario = sEl ? String(sEl.value || '') : '';
        var personality = pEl ? String(pEl.value || '') : '';
        var last = lEl ? String(lEl.value || '') : '';
        var mc = mEl ? +mEl.value : 0;
        if (isNaN(mc) || mc < 0) mc = 0;

        try {
          if (root.Sim.setCharacter) {
            root.Sim.setCharacter({ scenario: scenario, personality: personality });
          } else {
            var ctx = root.Sim.getCtx && root.Sim.getCtx();
            if (ctx && ctx.character) {
              ctx.character.scenario = scenario;
              ctx.character.personality = personality;
            }
          }

          if (root.Sim.setMessages) {
            root.Sim.setMessages([last]);
          } else {
            ctx = root.Sim.getCtx && root.Sim.getCtx();
            if (ctx && ctx.chat) {
              ctx.chat.last_message = last;
              ctx.chat.last_messages = [last];
            }
          }

          ctx = root.Sim.getCtx && root.Sim.getCtx();
          if (ctx && ctx.chat) ctx.chat.message_count = mc;

        } catch (_e2) { }
      }

      function wireCodeViewer() {
        var copyBtn = $('eng-copy-code');
        if (copyBtn) copyBtn.onclick = function () {
          var ta = $('eng-code');
          if (!ta) return;
          ta.focus();
          ta.select();
          try { document.execCommand('copy'); } catch (_e) { }
        };

        var dlBtn = $('eng-dl-package');
        if (dlBtn) dlBtn.onclick = function () {
          var runtime = root.DataShaper || root.EngineRuntime;
          if (runtime && typeof runtime.downloadPackage === 'function') {
            try {
              runtime.downloadPackage(studioState, { buildOrder: normalizeOrder(order) });
            } catch (e) { console.error("DL failed", e); }
          }
        };
      }

      function updateCodeViewer() {
        var ta = $('eng-code');
        if (!ta) return;

        var runtime = root.DataShaper || root.EngineRuntime;

        if (!runtime) {
          ta.value = '// No runtime found (DataShaper or EngineRuntime).\n// Check that export.core.js is loaded.';
          return;
        }

        var opts = {
          buildOrder: normalizeOrder(order),
          includeDisabled: false,
          includeDslAsJson: true
        };

        // 1. Try official convenience method (DataShaper.buildCodePreview)
        if (typeof runtime.buildCodePreview === 'function') {
          try {
            var res = runtime.buildCodePreview(studioState, opts);
            ta.value = String(res || '// buildCodePreview returned empty string');
            return;
          } catch (e1) {
            // Fall through to try manual pipeline if this fails (rare but possible if API mismatch)
            console.error("Basic Engine: buildCodePreview failed", e1);
            ta.value = '// Error in buildCodePreview:\n// ' + String(e1);
            // Don't return, try manual pipeline? No, manual pipeline uses same internals usually.
            // Just return error to show user.
            return;
          }
        }

        // 2. Try manual pipeline (Legacy EngineRuntime or partial DataShaper)
        if (typeof runtime.buildPackage === 'function') {
          try {
            var pkg = runtime.buildPackage(studioState, opts);

            // Render
            if (typeof runtime.renderPackageCode === 'function') {
              ta.value = runtime.renderPackageCode(pkg, opts) || '// renderPackageCode returned empty';
            } else if (typeof runtime.buildAdvancedScript === 'function') {
              // EngineRuntime legacy fallback
              ta.value = runtime.buildAdvancedScript(studioState, opts) || '// buildAdvancedScript returned empty';
            } else {
              // Just JSON dump if no renderer
              ta.value = '// No code renderer found. Package IR:\n' + JSON.stringify(pkg, null, 2);
            }
            return;
          } catch (e2) {
            console.error("Basic Engine: Manual pipeline failed", e2);
            ta.value = '// Error in manual pipeline:\n// ' + String(e2);
            return;
          }
        }

        ta.value = '// Runtime exists but has no build methods.\n// Keys: ' + Object.keys(runtime).join(', ');
      }

      function runPipeline(doEval) {
        var out = $('eng-results');
        if (!out) return;

        var wt2 = collectWriteTargetsWithViolations(studioState, order);
        var writeMap = wt2.map;
        var writeViolations = wt2.violations;

        var html = '';
        html += renderWriteTargetBlock(writeMap);
        html += renderWriteViolationsBlock(writeViolations);
        html += '<div class="eng-divider"></div>';

        // ✅ Correct globals (with casing fallback)
        var Validator = root.DSLValidate || root.DslValidate;
        var DSL = root.DSL;
        var EvalCore = root.EvalCore;

        if (!Validator || !DSL || !EvalCore) {
          html += '<div class="eng-muted">Missing engine components (DSLValidate/DSL/EvalCore).</div>';
          out.innerHTML = html;
          return;
        }

        if (writeViolations && writeViolations.length) {
          html += '<div class="eng-muted">Fix write-target violations before validating/evaluating.</div>';
          out.innerHTML = html;
          return;
        }

        pushIntoSim();

        var diagOut = { missing: [], errors: [] };
        var ruleSpecs = collectRuleSpecs(studioState, normalizeOrder(order), diagOut);

        // Validate (correct API)
        var diag;
        try {
          diag = Validator.validateRules(ruleSpecs);
        } catch (_e0) {
          diag = { errors: [{ message: 'Validator threw.' }], warnings: [] };
        }

        html += renderDiag(diag);

        if (diag && diag.errors && diag.errors.length) {
          html += '<div class="eng-muted">Fix validation errors to evaluate.</div>';
          out.innerHTML = html;
          return;
        }

        if (!doEval) {
          html += '<div class="eng-muted">Validation-only complete.</div>';
          out.innerHTML = html;
          return;
        }

        // Compile + Evaluate (matches your original engine flow)
        var rules = [];
        try { rules = DSL.compileRules(ruleSpecs) || []; } catch (_e1) { rules = []; }

        var ctx = {};
        if (root.Sim) {
          if (typeof root.Sim.getDevCtx === 'function') ctx = root.Sim.getDevCtx();
          else if (typeof root.Sim.getCtx === 'function') {
            var legacy = root.Sim.getCtx() || {};
            ctx = {
              context: { chat: legacy.chat || {}, character: legacy.character || {} },
              chat: legacy.chat || {},
              character: legacy.character || {}
            };
          }
        }

        var report;
        try {
          report = EvalCore.runRules(rules, {
            ctx: ctx,
            state: {},
            derived: {},
            trace: []
          });
        } catch (_e2) {
          report = { fired: [], conflicts: [], effects: null };
        }

        html += '<div class="eng-divider"></div>';
        html += '<div class="eng-block"><div class="eng-h">Eval Summary</div>';
        html += renderPills([
          '<span class="pill pill-ok">Fired: ' + (report.fired ? report.fired.length : 0) + '</span>',
          '<span class="pill pill-warn">Conflicts: ' + (report.conflicts ? report.conflicts.length : 0) + '</span>'
        ]);
        html += '</div>';

        if (report.fired && report.fired.length) {
          var firedIds = [];
          for (var f = 0; f < report.fired.length; f++) {
            var fr = report.fired[f];
            if (fr && fr.id) firedIds.push(String(fr.id));
            else firedIds.push(JSON.stringify(fr));
          }
          html += renderList(firedIds, 'Fired Rules');
        } else {
          html += renderList([], 'Fired Rules');
        }

        html += renderList(summarizeConflicts(report.conflicts), 'Conflicts');
        html += renderEffects(report.effects);

        try { EvalCore.print(report, { showTrace: true }); } catch (_e4) { }

        out.innerHTML = html + '<div class="eng-muted">Full trace printed to console via EvalCore.print(...).</div>';
      }
    }
  });

  // ---------- CSS injection once (SCOPED to .engine-panel) ----------
  function injectEngineCssOnce() {
    if (document.getElementById('engine-panel-css')) return;

    var css =
      ".engine-panel .engine-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}" +
      ".engine-panel .engine-col{min-width:0}" +

      ".engine-panel .eng-block{background:rgba(0,0,0,.06);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:12px}" +
      ".engine-panel .eng-h{font-weight:900;letter-spacing:.2px;margin-bottom:6px}" +
      ".engine-panel .eng-sub{font-weight:900;color:var(--muted);margin:10px 0 6px;text-transform:uppercase;font-size:12px;letter-spacing:.8px}" +
      ".engine-panel .eng-muted{color:var(--muted);font-weight:800;font-size:12px;line-height:1.35}" +
      ".engine-panel .eng-row{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}" +
      ".engine-panel .eng-form{display:grid;grid-template-columns:1fr;gap:8px;margin-top:10px}" +
      ".engine-panel .eng-lab{color:var(--muted);font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.8px;margin-top:4px}" +
      ".engine-panel .eng-ta{width:100%;resize:vertical;min-height:70px}" +
      ".engine-panel .eng-results{min-height:240px}" +

      ".engine-panel .eng-ul{margin:8px 0 0 18px;padding:0;color:var(--text);font-weight:800;font-size:12px}" +
      ".engine-panel .eng-divider{height:1px;background:var(--border);margin:12px 0}" +

      ".engine-panel .pill{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1px solid var(--border);font-weight:900;font-size:12px}" +
      ".engine-panel .pill-ok{background:rgba(82,196,26,.10);border-color:rgba(82,196,26,.35)}" +
      ".engine-panel .pill-warn{background:rgba(201,164,106,.10);border-color:rgba(201,164,106,.35)}" +
      ".engine-panel .pill-err{background:rgba(255,77,79,.10);border-color:rgba(255,77,79,.35)}" +

      ".engine-panel .eng-order{display:flex;flex-direction:column;gap:8px;margin-top:10px}" +
      ".engine-panel .eng-order-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid var(--border);border-radius:12px;background:rgba(43,33,27,.35)}" +
      ".engine-panel .eng-order-row.is-off{opacity:.55;filter:grayscale(.2)}" +
      ".engine-panel .eng-order-left{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}" +
      ".engine-panel .eng-order-name{font-weight:900}" +
      ".engine-panel .eng-order-id{color:var(--muted);font-weight:900;font-size:12px}" +
      ".engine-panel .eng-order-dot{width:10px;height:10px;border-radius:999px;border:1px solid rgba(0,0,0,.35)}" +
      ".engine-panel .eng-order-dot.on{background:var(--on)}" +
      ".engine-panel .eng-order-dot.off{background:var(--off)}" +
      ".engine-panel .eng-order-state{font-weight:900;font-size:11px;color:var(--muted);border:1px solid var(--border);padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.06)}" +
      ".engine-panel .eng-order-pr{font-weight:900;font-size:11px;color:var(--muted);border:1px solid var(--border);padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.06)}" +
      ".engine-panel .eng-mini{padding:6px 10px;border-radius:10px}" +

      "@media (max-width: 980px){.engine-panel .engine-grid{grid-template-columns:1fr}}";

    var style = document.createElement('style');
    style.id = 'engine-panel-css';
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

})(window);

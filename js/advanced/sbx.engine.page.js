/* js/advanced/sbx.engine.page.js
 * Advanced -> Editor -> Engine
 * Studio semantics + strict 2-column layout:
 * - LEFT: Module Organization (compact list + controls)
 * - RIGHT: Compile + Final Output (buttons + output viewer)
 *
 * Uses existing Studio semantics:
 * - side-tab / side-dot / active / is-off
 *
 * Theme-safe:
 * - Injects layout-only CSS (no colors/backgrounds/borders)
 */
(function (root) {
  'use strict';

  if (!root || !root.SBX) { throw new Error('sbx.engine.page.js requires SBX'); }

  var SBX = root.SBX;
  SBX.pages = SBX.pages || {};
  SBX.pages.engine = SBX.pages.engine || {};

  // ---------------------------
  // Helpers (ES5)
  // ---------------------------
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function esc(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function $(rootEl, sel) { return rootEl.querySelector(sel); }

  function lsGet(key, fallback) {
    try {
      var v = root.localStorage.getItem(key);
      return (v == null) ? fallback : v;
    } catch (_e) { return fallback; }
  }
  function lsSet(key, val) {
    try { root.localStorage.setItem(key, val); } catch (_e) {}
  }

  function safeDispatch(name, detail) {
    detail = detail || {};
    try {
      if (typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new CustomEvent(name, { detail: detail }));
        return;
      }
    } catch (_e0) {}
    try {
      var ev = document.createEvent('CustomEvent');
      ev.initCustomEvent(name, false, false, detail);
      root.dispatchEvent(ev);
    } catch (_e1) {}
  }

  // ---------------------------
  // Layout-only CSS injection (theme-safe)
  // ---------------------------
  var CSS_ID = 'sbx-eng-css';
  function injectCssOnce() {
    if (document.getElementById(CSS_ID)) return;

    // IMPORTANT: layout-only. No colors/background/borders.
    // Right column should "own" the space.
    var cssText = [
      '.sbxEng{display:block; width:100%; box-sizing:border-box;}',
      '.sbxEng *{box-sizing:border-box;}',

      /* Strict 2-col: left capped, right flexible */
      '.sbxEng-grid{display:grid; grid-template-columns:minmax(220px, 320px) 1fr; gap:12px; align-items:start; min-width:0;}',
      '@media (max-width: 900px){ .sbxEng-grid{grid-template-columns:1fr;} }',

      '.sbxEng-left{min-width:0;}',
      '.sbxEng-right{min-width:0;}',

      /* Compact module list (buttons are still side-tab semantics) */
      '.sbxEng-modList{display:flex; flex-direction:column; gap:6px; margin-top:8px; min-width:0;}',
      '.sbxEng-modList .side-tab{padding:6px 8px; font-size:11px; line-height:1.15; margin:0; width:100%;}',
      '.sbxEng-modList .side-tab span:first-child{display:inline-block; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}',
      '.sbxEng-modList .side-dot{margin-left:6px;}',

      /* Action bar wrap */
      '.sbxEng-actions{display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;}',

      /* Output should fill and not force overflow */
      '.sbxEng-out{width:100%; min-width:0;}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = CSS_ID;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(cssText));
    document.head.appendChild(style);
  }

  // ---------------------------
  // Build order persistence
  // ---------------------------
  var BUILD_ORDER_KEY = 'studio.buildOrder';

  function normalizeOrder(order, allowedIds) {
    if (!isArr(order)) order = [];
    var allowed = {};
    var i;

    for (i = 0; i < allowedIds.length; i++) allowed[String(allowedIds[i])] = true;

    var out = [];
    var seen = {};
    for (i = 0; i < order.length; i++) {
      var id = String(order[i]);
      if (!id || !allowed[id] || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    for (i = 0; i < allowedIds.length; i++) {
      var mid = String(allowedIds[i]);
      if (!seen[mid]) out.push(mid);
    }
    return out;
  }

  function loadBuildOrder(allowedIds) {
    var raw = lsGet(BUILD_ORDER_KEY, '');
    if (!raw) return normalizeOrder([], allowedIds);
    try { return normalizeOrder(JSON.parse(raw), allowedIds); }
    catch (_e) { return normalizeOrder([], allowedIds); }
  }

  function saveBuildOrder(order) {
    lsSet(BUILD_ORDER_KEY, JSON.stringify(order));
  }

  function idxOf(arr, id) {
    id = String(id || '');
    for (var i = 0; i < (arr || []).length; i++) {
      if (String(arr[i]) === id) return i;
    }
    return -1;
  }

  function swap(arr, i, j) {
    if (!arr) return;
    if (i < 0 || j < 0) return;
    if (i >= arr.length || j >= arr.length) return;
    if (i === j) return;
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }

  // ---------------------------
  // Modules list + Studio state
  // ---------------------------
  function getModulesList() {
    if (SBX.modules && typeof SBX.modules.list === 'function') {
      try {
        var lst = SBX.modules.list();
        return isArr(lst) ? lst : [];
      } catch (_e0) {}
    }
    if (SBX.moduleRegistry && isArr(SBX.moduleRegistry)) return SBX.moduleRegistry;
    return [];
  }

  function getStudioState() {
    if (SBX.store && typeof SBX.store.ensureStudioState === 'function') {
      try { return SBX.store.ensureStudioState(); } catch (_e1) {}
    }
    root.StudioState = root.StudioState || {};
    root.StudioState.data = root.StudioState.data || {};
    return root.StudioState;
  }

  // Convention: StudioState.data[moduleId].enabled !== false
  function getModuleEnabled(studioState, moduleId) {
    if (!studioState || !studioState.data) return true;
    var d = studioState.data[moduleId];
    if (!d || typeof d !== 'object') return true;
    return d.enabled !== false;
  }

  function setModuleEnabled(studioState, moduleId, enabled) {
    if (!studioState || !studioState.data) return;
    if (!studioState.data[moduleId] || typeof studioState.data[moduleId] !== 'object') {
      studioState.data[moduleId] = { enabled: !!enabled };
    } else {
      studioState.data[moduleId].enabled = !!enabled;
    }
  }

  function moduleLabel(mods, id) {
    id = String(id || '');
    for (var i = 0; i < mods.length; i++) {
      var m = mods[i] || {};
      var mid = String(m.id || m.moduleId || '');
      if (mid === id) return String(m.label || m.name || mid);
    }
    return id;
  }

  // ---------------------------
  // Compile / Package
  // ---------------------------
  function tryBuildPackage(studioState, buildOrder) {
    if (!root.EngineRuntime || typeof root.EngineRuntime.buildPackage !== 'function') {
      return { ok: false, error: 'EngineRuntime.buildPackage is not available.', pkg: null };
    }
    try {
      var pkg = root.EngineRuntime.buildPackage(studioState, { buildOrder: buildOrder });
      return { ok: true, error: null, pkg: pkg };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), pkg: null };
    }
  }

  function extractCompiledText(pkg) {
    if (!pkg) return '';
    if (typeof pkg.code === 'string') return pkg.code;
    if (typeof pkg.script === 'string') return pkg.script;
    if (typeof pkg.output === 'string') return pkg.output;
    try { return JSON.stringify(pkg, null, 2); } catch (_e) { return String(pkg); }
  }

  // ---------------------------
  // UI
  // ---------------------------
  function render(rootEl /*, ctx */) {
    injectCssOnce();

    var studioState = getStudioState();
    var mods = getModulesList();

    // Filter out internal/non-editable entries
    var moduleIds = [];
    for (var i = 0; i < mods.length; i++) {
      var m = mods[i] || {};
      var id = String(m.id || m.moduleId || '');
      if (!id) continue;
      if (id === 'engine') continue; // Engine is not a module
      moduleIds.push(id);
    }

    var order = loadBuildOrder(moduleIds);

    var ui = SBX.pages.engine._ui || { selectedModuleId: null, debugOpen: false, pkgOpen: false };
    if (!ui || typeof ui !== 'object') ui = { selectedModuleId: null, debugOpen: false, pkgOpen: false };

    if (!ui.selectedModuleId || idxOf(order, ui.selectedModuleId) < 0) {
      ui.selectedModuleId = order[0] || null;
    }
    SBX.pages.engine._ui = ui;

    // STRICT 2-column layout: left module org, right compile/output
    rootEl.innerHTML =
      '<div class="sbxEng">' +
        '<div class="sbxA-h2">Engine</div>' +
        '<div class="sbxA-sub">Left: module organization. Right: compile and final output.</div>' +

        '<div class="sbxEng-grid" style="margin-top:12px;">' +

          // LEFT
          '<div class="sbxEng-left">' +
            '<div class="sbxA-card">' +
              '<div class="sbxA-h3">Module Organization</div>' +
              '<div class="sbxA-muted">Select a module, then move/toggle/open.</div>' +
              '<div id="sbx-eng-mods" class="sbxEng-modList"></div>' +
              '<div class="sbxEng-actions">' +
                '<button class="btn btn-ghost" type="button" id="sbx-eng-up">Move Up</button>' +
                '<button class="btn btn-ghost" type="button" id="sbx-eng-down">Move Down</button>' +
                '<button class="btn btn-ghost" type="button" id="sbx-eng-toggle">Toggle Module Power</button>' +
                '<button class="btn btn-ghost" type="button" id="sbx-eng-open">Open Module Tab</button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // RIGHT
          '<div class="sbxEng-right">' +
            '<div class="sbxA-card">' +
              '<div class="sbxA-h3">Compile & Output</div>' +
              '<div class="sbxA-muted">Compiled script from all enabled modules, in order.</div>' +
              '<div class="sbxA-row" style="margin-top:10px;">' +
                '<button class="btn btn-primary" type="button" id="sbx-eng-compile">Compile All</button>' +
                '<button class="btn btn-ghost" type="button" id="sbx-eng-copy">Copy Final</button>' +
                '<button class="btn btn-ghost" type="button" id="sbx-eng-toggle-debug">' + (ui.debugOpen ? 'Hide' : 'Show') + ' Debug</button>' +
              '</div>' +
              '<div id="sbx-eng-status" class="sbxA-muted" style="margin-top:6px;"></div>' +
              '<textarea class="inp sbxA-ta sbxA-mono sbxEng-out" id="sbx-eng-output" rows="18" readonly></textarea>' +
            '</div>' +

            '<div class="sbxA-card" id="sbx-eng-debug" style="display:' + (ui.debugOpen ? 'block' : 'none') + '; margin-top:12px;">' +
              '<div class="sbxA-row" style="justify-content:space-between;">' +
                '<div class="sbxA-h3" style="margin:0;">Debug</div>' +
                '<button class="btn btn-ghost" type="button" id="sbx-eng-toggle-pkg">' + (ui.pkgOpen ? 'Collapse' : 'Expand') + ' Package JSON</button>' +
              '</div>' +
              '<div id="sbx-eng-pkg-wrap" style="display:' + (ui.pkgOpen ? 'block' : 'none') + '">' +
                '<textarea class="inp sbxA-ta sbxA-mono sbxEng-out" id="sbx-eng-pkg" rows="12" readonly></textarea>' +
              '</div>' +
            '</div>' +
          '</div>' +

        '</div>' +
      '</div>';

    function setStatus(msg) {
      var el = $(rootEl, '#sbx-eng-status');
      if (el) el.innerHTML = msg ? esc(msg) : '';
    }

    function renderModuleButtons() {
      order = loadBuildOrder(moduleIds);

      if (!ui.selectedModuleId || idxOf(order, ui.selectedModuleId) < 0) {
        ui.selectedModuleId = order[0] || null;
      }

      var host = $(rootEl, '#sbx-eng-mods');
      if (!host) return;

      var html = '';
      for (var j = 0; j < order.length; j++) {
        var id = String(order[j]);
        var on = getModuleEnabled(studioState, id);
        var isActive = (ui.selectedModuleId === id);

        html +=
          '<button type="button" class="side-tab' +
            (isActive ? ' active' : '') +
            (on ? '' : ' is-off') +
          '" data-mid="' + esc(id) + '">' +
            '<span>' + esc((j + 1) + ') ' + moduleLabel(mods, id)) + '</span>' +
            '<span class="side-dot ' + (on ? 'on' : 'off') + '"></span>' +
          '</button>';
      }

      host.innerHTML = html;
    }

    function selectModule(id) {
      id = String(id || '');
      if (!id) return;
      if (idxOf(order, id) < 0) return;
      ui.selectedModuleId = id;
      SBX.pages.engine._ui = ui;
      renderModuleButtons();
    }

    function moveSelected(delta) {
      var id = ui.selectedModuleId;
      if (!id) return;

      var i = idxOf(order, id);
      if (i < 0) return;

      var j = i + delta;
      if (j < 0 || j >= order.length) return;

      swap(order, i, j);
      saveBuildOrder(order);

      ui.selectedModuleId = order[j];
      SBX.pages.engine._ui = ui;

      renderModuleButtons();
      safeDispatch('SBX:modulesChanged', { buildOrder: order.slice(0) });
    }

    function toggleSelectedPower() {
      var id = ui.selectedModuleId;
      if (!id) return;

      var on = getModuleEnabled(studioState, id);
      setModuleEnabled(studioState, id, !on);

      try { if (SBX.store && typeof SBX.store.save === 'function') SBX.store.save(studioState); } catch (_e0) {}

      renderModuleButtons();
      safeDispatch('SBX:modulesChanged', { moduleId: id, enabled: !on });
    }

    function openSelectedModule() {
      var id = ui.selectedModuleId;
      if (!id) return;
      safeDispatch('SBX:openModule', { id: id });
    }

    function doCompile() {
      setStatus('');
      var outTa = $(rootEl, '#sbx-eng-output');
      var pkgTa = $(rootEl, '#sbx-eng-pkg');
      if (outTa) outTa.value = '';

      // Refresh state + order in case anything changed
      studioState = getStudioState();
      order = loadBuildOrder(moduleIds);

      var code = '';
      var pkg = null;

      // ✅ Preferred path: final JS via EngineRuntime.buildAdvancedScript
      if (root.EngineRuntime && typeof root.EngineRuntime.buildAdvancedScript === 'function') {
        try {
          code = String(
            root.EngineRuntime.buildAdvancedScript(studioState, { buildOrder: order }) || ''
          );
        } catch (e) {
          setStatus('Compile failed: ' + String(e && e.message ? e.message : e));
          if (pkgTa) pkgTa.value = '';
          return;
        }

        // For the debug panel, also try to build the JSON package
        if (pkgTa && typeof root.EngineRuntime.buildPackage === 'function') {
          try {
            pkg = root.EngineRuntime.buildPackage(studioState, { buildOrder: order });
          } catch (_e2) {
            pkg = null;
          }
        }
      } else {
        // 🔙 Fallback: existing JSON-based behavior
        var res = tryBuildPackage(studioState, order);
        if (!res.ok) {
          setStatus('Compile failed: ' + res.error);
          if (pkgTa) pkgTa.value = '';
          return;
        }
        pkg = res.pkg;
        code = extractCompiledText(pkg);
      }

      // Write final JS (or fallback) to main output
      if (outTa) {
        outTa.value = code || '';
        outTa.scrollTop = 0;
      }

      // Write JSON package to Debug → Package JSON
      if (pkgTa) {
        if (pkg) {
          try {
            pkgTa.value = JSON.stringify(pkg, null, 2);
          } catch (_e3) {
            pkgTa.value = String(pkg);
          }
          pkgTa.scrollTop = 0;
        } else {
          pkgTa.value = '';
        }
      }

      setStatus('Compiled OK.');
    }


    // Module selection (event delegation)
    var modsHost = $(rootEl, '#sbx-eng-mods');
    if (modsHost) {
      modsHost.onclick = function (ev) {
        ev = ev || root.event;
        var t = ev.target || ev.srcElement;
        if (!t) return;

        var n = t;
        while (n && n !== modsHost) {
          if (n.getAttribute && n.getAttribute('data-mid')) {
            selectModule(n.getAttribute('data-mid'));
            return;
          }
          n = n.parentNode;
        }
      };
    }

    // Left actions
    var up = $(rootEl, '#sbx-eng-up');
    var down = $(rootEl, '#sbx-eng-down');
    var tog = $(rootEl, '#sbx-eng-toggle');
    var open = $(rootEl, '#sbx-eng-open');

    if (up) up.onclick = function () { moveSelected(-1); };
    if (down) down.onclick = function () { moveSelected(1); };
    if (tog) tog.onclick = function () { toggleSelectedPower(); };
    if (open) open.onclick = function () { openSelectedModule(); };

    // Right actions
    var compileBtn = $(rootEl, '#sbx-eng-compile');
    var copyBtn = $(rootEl, '#sbx-eng-copy');

    if (compileBtn) compileBtn.onclick = doCompile;
    if (copyBtn) copyBtn.onclick = function () {
      var ta = $(rootEl, '#sbx-eng-output');
      if (!ta) return;
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (_e4) {}
    };

    // Debug toggles
    var dbgBtn = $(rootEl, '#sbx-eng-toggle-debug');
    var dbgWrap = $(rootEl, '#sbx-eng-debug');
    var pkgBtn = $(rootEl, '#sbx-eng-toggle-pkg');
    var pkgWrap = $(rootEl, '#sbx-eng-pkg-wrap');

    if (dbgBtn) dbgBtn.onclick = function () {
      ui.debugOpen = !ui.debugOpen;
      SBX.pages.engine._ui = ui;
      if (dbgWrap) dbgWrap.style.display = ui.debugOpen ? 'block' : 'none';
      dbgBtn.innerHTML = ui.debugOpen ? 'Hide Debug' : 'Show Debug';
    };

    if (pkgBtn) pkgBtn.onclick = function () {
      ui.pkgOpen = !ui.pkgOpen;
      SBX.pages.engine._ui = ui;
      if (pkgWrap) pkgWrap.style.display = ui.pkgOpen ? 'block' : 'none';
      pkgBtn.innerHTML = (ui.pkgOpen ? 'Collapse' : 'Expand') + ' Package JSON';
    };

    // Initial paint
    renderModuleButtons();
  }

  SBX.pages.engine.render = render;
})(window);

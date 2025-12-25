(function (root) {
  'use strict';

  var MountedPanels = {};

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  /* ============================================================
   * Panel Definition Resolver (registry-shape tolerant)
   * ============================================================ */
  function getPanelDef(panelId) {
    var P = root.Panels;
    if (!P) return null;

    // Common patterns:
    try { if (P.byId && P.byId[panelId]) return P.byId[panelId]; } catch (_e0) { }
    try {
      if (typeof P.get === 'function') {
        var d = P.get(panelId);
        if (d) return d;
      }
    } catch (_e1) { }
    try { if (P._defs && P._defs[panelId]) return P._defs[panelId]; } catch (_e2) { }
    try { if (P.defs && P.defs[panelId]) return P.defs[panelId]; } catch (_e3) { }
    try { if (P.registry && P.registry[panelId]) return P.registry[panelId]; } catch (_e4) { }

    // Array registries
    var arr = null;
    try { if (isArr(P.list)) arr = P.list; } catch (_e5) { }
    if (!arr) { try { if (isArr(P.panels)) arr = P.panels; } catch (_e6) { } }
    if (!arr) { try { if (isArr(P.items)) arr = P.items; } catch (_e7) { } }

    if (arr) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === panelId) return arr[i];
      }
    }

    // Last resort
    try { if (P[panelId]) return P[panelId]; } catch (_e8) { }

    return null;
  }

  function mountPanelIfNeeded(panelId) {
    if (MountedPanels[panelId]) return;

    var def = getPanelDef(panelId);
    var rootEl = document.getElementById(panelId + '-root');

    if (!def || !def.mount || !rootEl) return;

    def.mount(rootEl, root.StudioState);
    MountedPanels[panelId] = true;
  }

  function notifyPowerChange(panelId, enabled) {
    var def = getPanelDef(panelId);
    if (def && def.onPowerChange) def.onPowerChange(enabled);
  }

  function $(id) { return document.getElementById(id); }

  function addClass(el, c) {
    if (!el) return;
    if ((' ' + el.className + ' ').indexOf(' ' + c + ' ') === -1) {
      el.className = (el.className ? el.className + ' ' : '') + c;
    }
  }
  function removeClass(el, c) {
    if (!el) return;
    var s = ' ' + el.className + ' ';
    s = s.replace(' ' + c + ' ', ' ');
    el.className = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  }
  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) addClass(el, 'is-hidden'); else removeClass(el, 'is-hidden');
  }
  function setActive(el, on) {
    if (!el) return;
    if (on) addClass(el, 'active'); else removeClass(el, 'active');
  }

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (_e) { }
  }

  // Fixed panel order (tabs do NOT reorder)
  var PANELS = [
    { id: 'lorebook', label: 'Lorebook', defaultEnabled: true, defaultPrio: 50 },
    { id: 'voices', label: 'Voices', defaultEnabled: true, defaultPrio: 55 },
    { id: 'memory', label: 'Memory', defaultEnabled: true, defaultPrio: 60 },
    { id: 'events', label: 'Events', defaultEnabled: true, defaultPrio: 70 },
    { id: 'tone', label: 'Tone', defaultEnabled: true, defaultPrio: 40 },
    { id: 'ambient', label: 'Ambient', defaultEnabled: true, defaultPrio: 20 },
    { id: 'random', label: 'Random', defaultEnabled: true, defaultPrio: 30 },
    { id: 'conditionCombiner', label: 'Combined', defaultEnabled: true, defaultPrio: 10 },
    { id: 'scoring', label: 'Scoring', defaultEnabled: false, defaultPrio: 5 },
    { id: 'engine', label: 'Engine', defaultEnabled: true, defaultPrio: 0 }
  ];

  // StudioState: enabled + priority per panel (used later for export)
  var StudioState = root.StudioState || {};
  StudioState.panels = StudioState.panels || {};
  root.StudioState = StudioState;

  function ensureDefaults() {
    for (var i = 0; i < PANELS.length; i++) {
      var p = PANELS[i];
      if (!StudioState.panels[p.id]) {
        StudioState.panels[p.id] = {
          enabled: p.defaultEnabled,
          priority: p.defaultPrio
        };
      } else {
        if (typeof StudioState.panels[p.id].enabled !== 'boolean') StudioState.panels[p.id].enabled = p.defaultEnabled;
        if (typeof StudioState.panels[p.id].priority !== 'number') StudioState.panels[p.id].priority = p.defaultPrio;
      }
    }
  }

  function loadState() {
    ensureDefaults();
    var raw = lsGet('studio.panels', '');
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          StudioState.panels = parsed;
          ensureDefaults();
        }
      } catch (_e) { }
    }
    StudioState.debug = (lsGet('studio.debug', '0') === '1');
  }

  function saveState() {
    lsSet('studio.panels', JSON.stringify(StudioState.panels));
    lsSet('studio.debug', StudioState.debug ? '1' : '0');
  }

  function setPanelInputsEnabled(panelId, enabled) {
    var rootEl = $(panelId + '-root');
    if (!rootEl) return;

    // Disable/enable common form controls inside panel content area
    var nodes = rootEl.querySelectorAll ? rootEl.querySelectorAll('input, select, textarea, button') : [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      // Don't disable buttons that are explicitly marked as "always on"
      if (n && n.getAttribute && n.getAttribute('data-keep-enabled') === '1') continue;
      n.disabled = !enabled;
    }
  }

  function applyPanelPowerUI(panelId) {
    var state = StudioState.panels[panelId];
    var panelEl = $('panel-' + panelId);
    var pwrBtn = $('pwr-' + panelId);

    if (!state) return;

    // Panel styling
    if (panelEl) {
      if (state.enabled) removeClass(panelEl, 'is-off');
      else addClass(panelEl, 'is-off');
    }

    // Button styling + label/dot
    if (pwrBtn) {
      pwrBtn.setAttribute('aria-pressed', state.enabled ? 'true' : 'false');
      var dot = pwrBtn.querySelector ? pwrBtn.querySelector('.dot') : null;
      var lab = pwrBtn.querySelector ? pwrBtn.querySelector('.pwr-label') : null;

      if (dot) {
        dot.className = 'dot ' + (state.enabled ? 'dot-on' : 'dot-off');
      }
      if (lab) {
        lab.innerHTML = state.enabled ? 'On' : 'Off';
      }
    }

    // Disable/enable panel content controls
    setPanelInputsEnabled(panelId, state.enabled);
  }

  function renderSideTabs(containerId, activePanelId) {
    var host = $(containerId);
    if (!host) return;
    host.innerHTML = '';

    for (var i = 0; i < PANELS.length; i++) {
      (function (p) {
        var st = StudioState.panels[p.id];

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'side-tab' + (p.id === activePanelId ? ' active' : '') + (st && !st.enabled ? ' is-off' : '');
        btn.setAttribute('data-tab', p.id);

        var left = document.createElement('span');
        left.appendChild(document.createTextNode(p.label));

        var dot = document.createElement('span');
        dot.className = 'side-dot ' + ((st && st.enabled) ? 'on' : 'off');

        btn.appendChild(left);
        btn.appendChild(dot);

        btn.onclick = function () {
          activateBasicPanel(p.id);
          lsSet('studio.basic.panel', p.id);
        };

        host.appendChild(btn);
      })(PANELS[i]);
    }
  }

  function activateBasicPanel(panelId) {
    // Mount panel UI if this is the first visit
    mountPanelIfNeeded(panelId);

    // Show/hide panels
    for (var i = 0; i < PANELS.length; i++) {
      var id = PANELS[i].id;
      var el = $('panel-' + id);
      setHidden(el, id !== panelId);
    }

    // Update side tab active highlight
    renderSideTabs('side-tabs-basic', panelId);

    // Apply power styling (and input enable/disable)
    applyPanelPowerUI(panelId);

    // Scroll viewport to top (Studio feel)
    var vp = document.querySelector('#wrap-basic .panel-viewport');
    if (vp) vp.scrollTop = 0;
  }

  function wirePowerAndPriority() {
    for (var i = 0; i < PANELS.length; i++) {
      (function (p) {
        var st = StudioState.panels[p.id];

        // Priority input
        var prio = $('prio-' + p.id);
        if (prio) {
          prio.value = (st && typeof st.priority === 'number') ? st.priority : 0;
          prio.onchange = function () {
            var v = +prio.value;
            if (isNaN(v)) v = 0;
            StudioState.panels[p.id].priority = v;
            saveState();
          };
        }

        // Power toggle
        var pwr = $('pwr-' + p.id);
        if (pwr) {
          pwr.onclick = function () {
            StudioState.panels[p.id].enabled = !StudioState.panels[p.id].enabled;
            saveState();

            // Update panel + tabs visuals
            applyPanelPowerUI(p.id);

            // Re-render side tabs to update red/green dots + off styling
            var active = lsGet('studio.basic.panel', 'lorebook');
            renderSideTabs('side-tabs-basic', active);
          };
        }

        // Apply initial styling
        applyPanelPowerUI(p.id);

      })(PANELS[i]);
    }
  }

  function initParentTabs() {
    var wrapBasic = $('wrap-basic');
    var wrapAdv = $('wrap-advanced');
    var btnBasic = $('parent-basic');
    var btnAdv = $('parent-advanced');

    function set(which) {
      setHidden(wrapBasic, which !== 'basic');
      setHidden(wrapAdv, which !== 'advanced');
      setActive(btnBasic, which === 'basic');
      setActive(btnAdv, which === 'advanced');
      lsSet('studio.parent', which);

      // If user switches to Advanced, mount the active advanced panel once.
      if (which === 'advanced') {
        var cur = lsGet('studio.adv.panel', 'adv-editor');
        mountPanelIfNeeded(cur);
      }
    }

    if (btnBasic) btnBasic.onclick = function () { set('basic'); };
    if (btnAdv) btnAdv.onclick = function () { set('advanced'); };

    var initial = lsGet('studio.parent', 'basic');
    if (initial !== 'basic' && initial !== 'advanced') initial = 'basic';
    set(initial);
  }

  function initAdvancedSideTabs() {
    var host = $('side-tabs-advanced');
    if (!host) return;
    var btns = host.getElementsByTagName('button');

    function activate(id) {
      // IMPORTANT: mount advanced panel lazily on first activation
      mountPanelIfNeeded(id);

      setHidden($('panel-adv-editor'), id !== 'adv-editor');
      setHidden($('panel-adv-tools'), id !== 'adv-tools');

      for (var i = 0; i < btns.length; i++) {
        setActive(btns[i], btns[i].getAttribute('data-tab') === id);
      }

      lsSet('studio.adv.panel', id);

      var vp = (document.querySelector && document.querySelector('#wrap-advanced .panel-viewport')) ? document.querySelector('#wrap-advanced .panel-viewport') : null;
      if (vp) vp.scrollTop = 0;
    }

    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.onclick = function () { activate(b.getAttribute('data-tab')); };
      })(btns[i]);
    }

    activate(lsGet('studio.adv.panel', 'adv-editor'));
  }

  // --------------------------------------------------------------------------
  // Global Header Actions
  // --------------------------------------------------------------------------
  var clearBtn = $('btn-clear-all');
  if (clearBtn) {
    clearBtn.onclick = function () {
      // First confirmation
      if (!root.confirm(
        '⚠ WARNING: CLEAR ALL DATA? ⚠\n\n' +
        'This will permanently delete all your work across ALL panels (Lorebook, Memory, Advanced Editor, Engine, etc.)\n\n' +
        'This action cannot be undone. Are you absolutely sure?'
      )) return;

      // Second confirmation (Safety Catch)
      var code = root.prompt('FINAL SAFETY CHECK:\n\nPlease type "RESET" in all caps to confirm total wipe of all RuleForge data.');
      if (code !== 'RESET') {
        if (code !== null) root.alert('Confirmation failed. No data was cleared.');
        return;
      }

      try {
        localStorage.clear();
        root.location.reload();
      } catch (e) {
        root.alert('Error clearing data: ' + e.message);
      }
    };
  }

  var helpBtn = $('btn-help');
  if (helpBtn) {
    helpBtn.onclick = function () {
      root.alert(
        'RuleForge Quick Help\n\n' +
        '1. Basic: Use dedicated panels for Lorebook, Memory, Events, etc. for standard keyword logic.\n' +
        '2. Advanced: Import Basic data into modules to add full IF/ELSEIF/ELSE logic and complex conditions.\n' +
        '3. Engine: Organize your modules by build order and compile the final JanitorAI script.\n\n' +
        'Progress is saved automatically to your browser storage.'
      );
    };
  }

  // Boot
  loadState();
  initParentTabs();
  initAdvancedSideTabs();

  StudioState.debug = !!StudioState.debug;

  // Render side tabs and activate remembered panel
  var startPanel = lsGet('studio.basic.panel', 'lorebook');
  renderSideTabs('side-tabs-basic', startPanel);
  wirePowerAndPriority();
  activateBasicPanel(startPanel);

})(window);

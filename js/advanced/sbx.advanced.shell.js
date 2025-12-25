(function (root) {
  'use strict';
  // Advanced Shell: Engine + Test Harness + per-module subtabs (ES5).
  // Requirements:
  //  - No "second Engine" in module subtabs (engine is not a module editor)
  //  - Subtab "lights" (side-dot on/off + is-off shading) update immediately when Engine changes power/order
  //  - Remove shell-level Compile/Copy/Debug toolbar (controls belong inside Engine's Compile & Output card)

  var SBX = (root.SBX = root.SBX || {});
  SBX.advanced = SBX.advanced || {};

  var dom = SBX.dom;
  var css = SBX.css;
  var store = SBX.store;

  var CSS_ID = 'sbx-advanced-css';

  // Keep one live mount reference so global listeners can refresh the current UI
  var Live = {
    mounted: false,
    renderTabsActive: null,
    refreshMeta: null,
    renderAll: null,
    getState: null
  };

  function injectCss() {
    if (document.getElementById(CSS_ID)) return;

    // Layout-only; theme controls visuals.
    var rules = [
      '.sbxA{display:block; width:100%; box-sizing:border-box;}',
      '.sbxA *{box-sizing:border-box;}',

      '.sbxA-head{padding:12px 12px 0;}',
      '.sbxA-title{font-weight:1000; font-size:16px; line-height:1.2;}',
      '.sbxA-sub{font-weight:800; font-size:12px; line-height:1.35; opacity:.85; margin-top:4px;}',

      '.sbxA-metaRow{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:10px;}',
      '.sbxA-metaGroup{display:inline-flex; align-items:baseline; gap:8px; flex-wrap:wrap;}',
      '.sbxA-metaLabel{font-weight:900; font-size:11px; letter-spacing:.7px; text-transform:uppercase; opacity:.75;}',
      '.sbxA-metaVal{font-weight:1000; font-size:12px;}',

      '.sbxA-toprow{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px; flex-wrap:wrap;}',
      '.sbxA-subtabs{display:flex; gap:8px; flex-wrap:wrap; align-items:center;}',

      '.sbxA-body{padding:12px; min-width:0;}',

      // Mini side-tab sizing for module subtabs (layout-only)
      '.sbxA-miniTab{width:auto; display:inline-flex; align-items:center; justify-content:space-between; gap:10px;}',
      '.sbxA-miniTab .side-dot{margin-left:10px;}',
      '.sbxA-miniTab{padding:8px 10px; font-size:12px; border-radius:12px;}'
    ];

    css.injectOnce(CSS_ID, rules.join('\n'));
  }

  function ensureState() {
    // Use new store API but preserve old semantics
    var st = store.load(root, { dataKey: 'sitebuilderx', storeKey: 'studio.sitebuilderx' });
    st = st || (store.DEFAULTS ? store.DEFAULTS() : {});
    st.advanced = st.advanced || {};
    if (!st.advanced.activeTopTab) st.advanced.activeTopTab = 'engine'; // engine | test | module
    if (!st.advanced.activeModule) st.advanced.activeModule = 'lorebook';
    if (typeof st.advanced.sbxOn !== 'boolean') st.advanced.sbxOn = true;
    store.save(root, st, { dataKey: 'sitebuilderx', storeKey: 'studio.sitebuilderx' });
    return st;
  }

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function safeModsList() {
    try {
      if (SBX.modules && typeof SBX.modules.list === 'function') {
        var lst = SBX.modules.list();
        if (isArr(lst)) return lst;
      }
    } catch (_e0) { }
    return [];
  }

  function getStudioState() {
    root.StudioState = root.StudioState || {};
    root.StudioState.data = root.StudioState.data || {};
    return root.StudioState;
  }

  function isModuleEnabled(studioState, moduleId) {
    if (!studioState || !studioState.data) return true;
    var d = studioState.data[moduleId];
    if (!d || typeof d !== 'object') return true;
    return d.enabled !== false;
  }

  function tryCountWarnings() {
    try {
      var runtime = root.DataShaper || root.EngineRuntime;
      if (!runtime || typeof runtime.buildPackage !== 'function') return 0;
      var pkg = runtime.buildPackage(getStudioState(), { silent: true });
      if (!pkg || !pkg.warnings) return 0;
      return pkg.warnings.length || 0;
    } catch (_e) {
      return 0;
    }
  }

  function mount(rootEl) {
    injectCss();
    var st = ensureState();

    dom.empty(rootEl);

    var shell = dom.el('div', { className: 'sbxA' });

    // Header
    var head = dom.el('div', { className: 'sbxA-head' });
    head.appendChild(dom.el('div', { className: 'sbxA-title', text: 'RuleForge Advanced' }));
    head.appendChild(dom.el('div', {
      className: 'sbxA-sub',
      text: 'Engine manages ordering + power + compilation. Harness exercises sources. Module tabs open refinements (edits flow forward only).'
    }));

    // Meta row
    var metaRow = dom.el('div', { className: 'sbxA-metaRow' });

    var pwr = dom.el('button', { className: 'btn btn-ghost', text: st.advanced.sbxOn ? 'On' : 'Off' });
    pwr.setAttribute('type', 'button');
    pwr.setAttribute('aria-pressed', st.advanced.sbxOn ? 'true' : 'false');
    pwr.onclick = function () {
      st.advanced.sbxOn = !st.advanced.sbxOn;
      store.save(root, st, { dataKey: 'sitebuilderx', storeKey: 'studio.sitebuilderx' });
      pwr.innerHTML = st.advanced.sbxOn ? 'On' : 'Off';
      pwr.setAttribute('aria-pressed', st.advanced.sbxOn ? 'true' : 'false');

      if (typeof Live.refreshMeta === 'function') Live.refreshMeta();
      if (typeof Live.renderAll === 'function') Live.renderAll();
    };

    var warningsBadge = dom.el('span', { className: 'sbxA-metaVal', text: '' });
    var warnCount = tryCountWarnings();
    if (warnCount > 0) warningsBadge.textContent = warnCount + ' warnings';

    var powerGroup = dom.el('div', { className: 'sbxA-metaGroup', text: '' });
    powerGroup.appendChild(dom.el('span', { className: 'sbxA-metaLabel', text: 'POWER' }));
    powerGroup.appendChild(pwr);
    metaRow.appendChild(powerGroup);

    var warnGroup = dom.el('div', { className: 'sbxA-metaGroup', text: '' });
    warnGroup.appendChild(dom.el('span', { className: 'sbxA-metaLabel', text: 'WARNINGS' }));
    warnGroup.appendChild(warningsBadge);
    metaRow.appendChild(warnGroup);

    head.appendChild(metaRow);

    // Tabs row
    var topRow = dom.el('div', { className: 'sbxA-toprow' });
    var subtabs = dom.el('div', { className: 'sbxA-subtabs' });

    var btnEngine = dom.el('button', { className: 'btn btn-ghost', text: 'Engine' });
    btnEngine.setAttribute('type', 'button');
    var btnTest = dom.el('button', { className: 'btn btn-ghost', text: 'Test Harness' });
    btnTest.setAttribute('type', 'button');

    subtabs.appendChild(btnEngine);
    subtabs.appendChild(btnTest);

    var moduleBtns = {}; // moduleId -> { btn, dot }

    function buildModuleTabs() {
      // Remove any nodes after the fixed Engine/Harness buttons
      while (subtabs.childNodes.length > 2) {
        subtabs.removeChild(subtabs.lastChild);
      }
      moduleBtns = {};

      var mods = safeModsList();
      for (var i = 0; i < mods.length; i++) {
        (function (mm) {
          var id = String(mm && mm.id ? mm.id : '');
          if (!id) return;
          if (id === 'engine') return; // prevent second Engine

          var label = String(mm && mm.label ? mm.label : id);

          var b = dom.el('button', { className: 'side-tab sbxA-miniTab' });
          b.setAttribute('type', 'button');

          var left = document.createElement('span');
          left.appendChild(document.createTextNode(label));

          var dot = document.createElement('span');
          dot.className = 'side-dot ' + (isModuleEnabled(getStudioState(), id) ? 'on' : 'off');

          b.appendChild(left);
          b.appendChild(dot);

          b.onclick = function () {
            st.advanced.activeTopTab = 'module';
            st.advanced.activeModule = id;
            store.save(root, st, { dataKey: 'sitebuilderx', storeKey: 'studio.sitebuilderx' });
            renderAll();
          };

          moduleBtns[id] = { btn: b, dot: dot };
          subtabs.appendChild(b);

        })(mods[i]);
      }
    }

    buildModuleTabs();

    topRow.appendChild(subtabs);
    head.appendChild(topRow);

    shell.appendChild(head);

    // Body
    var body = dom.el('div', { className: 'sbxA-body' });
    var contentHost = dom.el('div', {});
    body.appendChild(contentHost);
    shell.appendChild(body);

    function setBtnActiveClass(el, isActive) {
      if (!el) return;
      el.className = el.className.replace(/\s+active\b/g, '');
      if (isActive) el.className += ' active';
    }

    function setBtnOffClass(el, isOff) {
      if (!el) return;
      el.className = el.className.replace(/\s+is-off\b/g, '');
      if (isOff) el.className += ' is-off';
    }

    function renderTabsActive() {
      var topTab = st.advanced.activeTopTab;
      var activeMod = st.advanced.activeModule;

      setBtnActiveClass(btnEngine, topTab === 'engine');
      setBtnActiveClass(btnTest, topTab === 'test');

      var studioState = getStudioState();
      for (var mid in moduleBtns) {
        if (!moduleBtns.hasOwnProperty(mid)) continue;
        var bundle = moduleBtns[mid];
        if (!bundle || !bundle.btn) continue;

        var isActive = (topTab === 'module' && mid === activeMod);
        setBtnActiveClass(bundle.btn, isActive);

        var enabled = isModuleEnabled(studioState, mid);
        setBtnOffClass(bundle.btn, !enabled);
        if (bundle.dot) {
          bundle.dot.className = 'side-dot ' + (enabled ? 'on' : 'off');
        }
      }
    }

    function renderBody() {
      dom.empty(contentHost);
      var topTab = st.advanced.activeTopTab;
      var modId = st.advanced.activeModule;

      if (topTab === 'engine') {
        if (SBX.pages && SBX.pages.engine && typeof SBX.pages.engine.render === 'function') {
          SBX.pages.engine.render(contentHost);
        } else {
          contentHost.textContent = 'Engine page not available.';
        }
        return;
      }

      if (topTab === 'test') {
        if (SBX.pages && SBX.pages.test && typeof SBX.pages.test.render === 'function') {
          SBX.pages.test.render(contentHost);
        } else {
          contentHost.textContent = 'Test harness page not available.';
        }
        return;
      }

      if (SBX.pages && SBX.pages.module && typeof SBX.pages.module.render === 'function') {
        SBX.pages.module.render(contentHost, modId);
      } else {
        contentHost.textContent = 'Module page not available.';
      }
    }

    function refreshMeta() {
      var count = tryCountWarnings();
      warningsBadge.textContent = count > 0 ? (count + ' warnings') : '';
    }

    function renderAll() {
      renderTabsActive();
      renderBody();
      refreshMeta();
    }

    btnEngine.onclick = function () {
      st.advanced.activeTopTab = 'engine';
      store.save(root, st, { dataKey: 'sitebuilderx', storeKey: 'studio.sitebuilderx' });
      renderAll();
    };

    btnTest.onclick = function () {
      st.advanced.activeTopTab = 'test';
      store.save(root, st, { dataKey: 'sitebuilderx', storeKey: 'studio.sitebuilderx' });
      renderAll();
    };

    renderAll();

    Live.mounted = true;
    Live.renderTabsActive = renderTabsActive;
    Live.refreshMeta = refreshMeta;
    Live.renderAll = renderAll;
    Live.getState = function () { return st; };

    rootEl.appendChild(shell);
  }

  // ------------------------------------------------------------
  // Global listeners (register ONCE)
  // ------------------------------------------------------------
  function ensureGlobalListenersOnce() {
    if (SBX.advanced._listenersBound) return;
    SBX.advanced._listenersBound = true;

    try {
      root.addEventListener('SBX:modulesChanged', function () {
        if (!Live.mounted) return;
        if (typeof Live.renderTabsActive === 'function') Live.renderTabsActive();
        if (typeof Live.refreshMeta === 'function') Live.refreshMeta();
      });
    } catch (_e0) { }

    try {
      root.addEventListener('SBX:openModule', function (ev) {
        if (!ev || !ev.detail) return;
        var id = ev.detail.id;
        if (!id) return;

        id = String(id);
        if (id === 'engine') return;

        var st = Live.getState ? Live.getState() : ensureState();
        st.advanced.activeTopTab = 'module';
        st.advanced.activeModule = id;

        try { if (store && typeof store.save === 'function') store.save(root, st, { dataKey: 'sitebuilderx', storeKey: 'studio.sitebuilderx' }); } catch (_e1) { }

        if (typeof Live.renderAll === 'function') Live.renderAll();
      });
    } catch (_e2) { }
  }

  ensureGlobalListenersOnce();
  SBX.advanced.mount = mount;
})(window);

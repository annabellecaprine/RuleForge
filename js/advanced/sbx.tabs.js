(function (root) {
  'use strict';
  // Simple tab + subtab controller (ES5). Depends on sbx.dom.js.
  var SBX = (root.SBX = root.SBX || {});
  SBX.tabs = SBX.tabs || {};
  var dom = SBX.dom;

  function initTabs(opts) {
    // opts: { rootEl, tabSel, panelSel, activeClass, onChange }
    opts = opts || {};
    var rootEl = opts.rootEl || document;
    var tabSel = opts.tabSel || '[data-tab]';
    var panelSel = opts.panelSel || '[data-panel]';
    var active = opts.activeClass || 'active';

    function setActive(id) {
      var tabs = dom.qa(tabSel, rootEl);
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var tid = t.getAttribute('data-tab') || t.id || '';
        if (tid === id) t.classList.add(active);
        else t.classList.remove(active);
        t.setAttribute('aria-selected', tid === id ? 'true' : 'false');
      }

      var panels = dom.qa(panelSel, rootEl);
      for (var j = 0; j < panels.length; j++) {
        var p = panels[j];
        var pid = p.getAttribute('data-panel') || p.id || '';
        if (pid === id) p.classList.remove('is-hidden');
        else p.classList.add('is-hidden');
      }

      if (typeof opts.onChange === 'function') opts.onChange(id);
    }

    dom.delegate(rootEl, 'click', tabSel, function (e, btn) {
      var id = btn.getAttribute('data-tab') || btn.id;
      if (!id) return;
      setActive(id);
    });

    return { setActive: setActive };
  }

  SBX.tabs.init = initTabs;
})(window);

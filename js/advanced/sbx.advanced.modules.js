(function (root) {
  'use strict';

  var SBX = root.SBX = root.SBX || {};
  SBX.Advanced = SBX.Advanced || {};
  SBX.Advanced.Modules = SBX.Advanced.Modules || {};

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function esc(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Registry of module subtabs (ids should match Basic panel IDs where possible)
  var REG = [
    { id: 'lorebook', label: 'Lorebook' },
    { id: 'voices', label: 'Voices' },
    { id: 'memory', label: 'Memory' },
    { id: 'events', label: 'Events' },
    { id: 'tone', label: 'Tone' },
    { id: 'ambient', label: 'Ambient' },
    { id: 'random', label: 'Random' },
    { id: 'conditionCombiner', label: 'Cond Combiner' },
    { id: 'scoring', label: 'Scoring' }
  ];

  function getModules() { return REG.slice(); }

  function mountModuleEditor(host, api, moduleId) {
    var module = null;
    for (var i = 0; i < REG.length; i++) if (REG[i].id === moduleId) module = REG[i];
    if (!module) module = { id: moduleId, label: moduleId };

    host.innerHTML =
      '<div class="sbx-sec">' +
        '<div class="sbx-sec-h">' +
          '<div class="sbx-h2">' + esc(module.label) + '</div>' +
          '<div class="sbx-small">Module-specific refinement blocks (forward-only; does not modify Basic).</div>' +
        '</div>' +

        '<div class="sbx-row">' +
          '<button class="btn btn-ghost" type="button" data-add="if">Add IF</button>' +
          '<button class="btn btn-ghost" type="button" data-add="elseif">Add ELSE IF</button>' +
          '<button class="btn btn-ghost" type="button" data-add="else">Add ELSE</button>' +
        '</div>' +

        '<div class="sbx-row sbx-row-stack">' +
          '<div class="sbx-h3">Blocks in this module</div>' +
          '<div id="sbx-mod-list" class="sbx-card"></div>' +
        '</div>' +

        '<div class="sbx-row sbx-row-stack">' +
          '<div class="sbx-h3">Notes</div>' +
          '<div class="sbx-muted">Next: embed the full SBX editor widgets here, scoped to groupId = "' + esc(module.label) + '".</div>' +
        '</div>' +
      '</div>';

    function $(sel) { return host.querySelector(sel); }
    function getD() { return api.getData(); }

    function moduleGroupId() {
      // This is the string that gets stamped on blocks so Engine can group/sort later
      // You can switch to REG[i].label or raw moduleId — whichever you standardize on.
      return module.label;
    }

    function renderList() {
      var d = getD();
      var blocks = (d && d.appState && isArr(d.appState.blocks)) ? d.appState.blocks : [];
      var gid = moduleGroupId();

      var wrap = $('#sbx-mod-list');
      if (!wrap) return;

      var filtered = [];
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i] || {};
        if (toStr(b.groupId) === toStr(gid)) filtered.push({ b: b, idx: i });
      }

      if (!filtered.length) {
        wrap.innerHTML = '<div class="sbx-muted">(no blocks yet for this module)</div>';
        return;
      }

      var html = '';
      for (i = 0; i < filtered.length; i++) {
        var it = filtered[i];
        var bb = it.b;

        html +=
          '<div class="sbx-row sbx-row-tight" data-idx="' + it.idx + '">' +
            '<span class="sbx-chip">' + esc(String(bb.type || 'if').toUpperCase()) + '</span>' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
              esc(bb.label || ('Block ' + (i + 1))) +
            '</span>' +
            '<button class="btn btn-ghost" type="button" data-act="del">Remove</button>' +
          '</div>';
      }
      wrap.innerHTML = html;

      var rows = wrap.querySelectorAll('[data-idx]');
      for (var r = 0; r < rows.length; r++) {
        rows[r].onclick = function (ev) {
          var act = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-act') : '';
          if (act !== 'del') return;

          var idx = parseInt(this.getAttribute('data-idx'), 10);
          var d2 = getD();
          d2.appState.blocks.splice(idx, 1);
          api.saveData();
          renderList();
        };
      }
    }

    function toStr(x) { return String(x == null ? '' : x); }

    host.onclick = function (ev) {
      var add = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-add') : '';
      if (!add) return;

      var d = getD();
      var b = SBX.Model.makeDefaultBlock(add);
      b.groupId = moduleGroupId();
      b.label = module.label + ': ' + String(add).toUpperCase();
      d.appState.blocks.push(b);
      api.saveData();
      renderList();
    };

    renderList();

    return {
      refresh: function () { renderList(); }
    };
  }

  SBX.Advanced.Modules.getModules = getModules;
  SBX.Advanced.Modules.mountEditor = mountModuleEditor;

})(window);

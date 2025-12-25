(function (root) {
  'use strict';

  var SBX = root.SBX = root.SBX || {};
  SBX.Advanced = SBX.Advanced || {};
  SBX.Advanced.Engine = SBX.Advanced.Engine || {};

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function esc(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function mount(host, api) {
    // api: { getData(), saveData(), refreshAll? }
    host.innerHTML =
      '<div class="sbx-sec">' +
        '<div class="sbx-sec-h">' +
          '<div class="sbx-h2">Engine</div>' +
          '<div class="sbx-small">Organize blocks, generate final JanitorAI code.</div>' +
        '</div>' +

        '<div class="sbx-row">' +
          '<button class="btn btn-ghost" type="button" data-act="gen">Generate</button>' +
          '<button class="btn btn-ghost" type="button" data-act="validate">Validate</button>' +
        '</div>' +

        '<div class="sbx-row sbx-row-stack">' +
          '<div class="sbx-h3">Block Order</div>' +
          '<div id="sbx-eng-list" class="sbx-card"></div>' +
        '</div>' +

        '<div class="sbx-row sbx-row-stack">' +
          '<div class="sbx-h3">Output</div>' +
          '<textarea class="inp sbx-ta sbx-ta-mono" id="sbx-eng-out" rows="18" readonly></textarea>' +
        '</div>' +
      '</div>';

    function $(sel) { return host.querySelector(sel); }
    function getD() { return api.getData(); }

    function renderList() {
      var d = getD();
      var blocks = (d && d.appState && isArr(d.appState.blocks)) ? d.appState.blocks : [];
      var wrap = $('#sbx-eng-list');
      if (!wrap) return;

      if (!blocks.length) {
        wrap.innerHTML = '<div class="sbx-muted">(no blocks yet)</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i] || {};
        html +=
          '<div class="sbx-row sbx-row-tight" data-idx="' + i + '">' +
            '<span class="sbx-chip">' + esc(String(b.type || 'if').toUpperCase()) + '</span>' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
              esc(b.label || ('Block ' + (i + 1))) +
              (b.groupId ? (' <span class="sbx-tag">[' + esc(b.groupId) + ']</span>') : '') +
            '</span>' +
            '<button class="btn btn-ghost" type="button" data-move="up">^</button>' +
            '<button class="btn btn-ghost" type="button" data-move="dn">v</button>' +
          '</div>';
      }
      wrap.innerHTML = html;

      // wire moves
      var rows = wrap.querySelectorAll('[data-idx]');
      for (var r = 0; r < rows.length; r++) {
        rows[r].onclick = function (ev) {
          var btn = ev.target;
          var move = btn && btn.getAttribute ? btn.getAttribute('data-move') : '';
          if (!move) return;

          var idx = parseInt(this.getAttribute('data-idx'), 10);
          var d2 = getD();
          var arr = d2.appState.blocks;

          if (move === 'up' && idx > 0) {
            var tmp = arr[idx - 1]; arr[idx - 1] = arr[idx]; arr[idx] = tmp;
            api.saveData(); renderList();
          }
          if (move === 'dn' && idx < arr.length - 1) {
            var tmp2 = arr[idx + 1]; arr[idx + 1] = arr[idx]; arr[idx] = tmp2;
            api.saveData(); renderList();
          }
        };
      }
    }

    function renderOutput() {
      var d = getD();
      var out = $('#sbx-eng-out');
      if (!out) return;
      out.value = SBX.Codegen.generate(d.appState);
      out.scrollTop = 0;
    }

    function validateOnly() {
      var d = getD();
      var msgs = SBX.Codegen.validate(d.appState);
      var out = $('#sbx-eng-out');
      if (!out) return;

      if (!msgs.length) out.value = '// OK: no validation warnings.';
      else out.value = '// WARNINGS:\n' + msgs.map(function (m) { return '// - ' + m; }).join('\n');
      out.scrollTop = 0;
    }

    // toolbar
    host.onclick = function (ev) {
      var act = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-act') : '';
      if (!act) return;
      if (act === 'gen') { renderOutput(); }
      if (act === 'validate') { validateOnly(); }
    };

    // initial
    renderList();
    renderOutput();

    // API back to shell
    return {
      refresh: function () { renderList(); renderOutput(); }
    };
  }

  SBX.Advanced.Engine.mount = mount;

})(window);

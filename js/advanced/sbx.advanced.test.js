(function (root) {
  'use strict';

  var SBX = root.SBX = root.SBX || {};
  SBX.Advanced = SBX.Advanced || {};
  SBX.Advanced.Test = SBX.Advanced.Test || {};

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function toStr(x) { return String(x == null ? '' : x); }

  // Persist test UI state inside sbx data (so it survives refresh)
  function ensureTestState(data) {
    data.ui = data.ui || {};
    data.ui.test = data.ui.test || {};

    var t = data.ui.test;
    if (!isArr(t.messages)) t.messages = [];
    if (typeof t.personality !== 'string') t.personality = '';
    if (typeof t.scenario !== 'string') t.scenario = '';
    if (typeof t.example_dialogs !== 'string') t.example_dialogs = '';
    if (typeof t.memoryJson !== 'string') t.memoryJson = '{}';
    if (typeof t.chatMetaJson !== 'string') t.chatMetaJson = '{"public_message_count":0}';
    if (typeof t.sourcesJson !== 'string') t.sourcesJson = '{}';
    if (typeof t.lastLog !== 'string') t.lastLog = '';
    if (typeof t.sourcesOpen !== 'boolean') t.sourcesOpen = true;

    return t;
  }

  function mount(host, api) {
    // api: { getData(), saveData() }
    var data = api.getData();
    var tstate = ensureTestState(data);

    host.innerHTML =
      '<div class="sbx-sec">' +
        '<div class="sbx-sec-h">' +
          '<div class="sbx-h2">Test Harness</div>' +
          '<div class="sbx-small">Simulate a JanitorAI run with full sources + chat context. Shows a detailed trace.</div>' +
        '</div>' +

        '<div class="sbx-row">' +
          '<button class="btn btn-primary" type="button" data-act="run">Run Test</button>' +
          '<button class="btn btn-ghost" type="button" data-act="reset">Reset</button>' +
        '</div>' +

        '<div class="sbx-layout" style="grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">' +

          // LEFT: inputs
          '<div class="sbx-col">' +

            '<div class="sbx-section">' +
              '<div class="sbx-h3">Character Fields</div>' +
              '<label class="sbx-lab">Personality<textarea class="inp sbx-ta" id="sbx-t-personality" rows="4"></textarea></label>' +
              '<label class="sbx-lab">Scenario<textarea class="inp sbx-ta" id="sbx-t-scenario" rows="4"></textarea></label>' +
              '<label class="sbx-lab">Example Dialogs<textarea class="inp sbx-ta" id="sbx-t-examples" rows="4"></textarea></label>' +
            '</div>' +

            '<div class="sbx-section">' +
              '<div class="sbx-h3">Memory (JSON)</div>' +
              '<div class="sbx-small">This becomes <code>context.character.memory</code>.</div>' +
              '<textarea class="inp sbx-ta sbx-ta-mono" id="sbx-t-memory" rows="6"></textarea>' +
              '<div class="sbx-muted" id="sbx-t-memerr" style="margin-top:6px;"></div>' +
            '</div>' +

            '<div class="sbx-section">' +
              '<div class="sbx-h3">Chat History</div>' +
              '<div class="sbx-small">These become <code>context.chat.last_messages</code>. Last entry is the last user message.</div>' +
              '<div id="sbx-t-msgs" class="sbx-card"></div>' +
              '<div class="sbx-row">' +
                '<button class="btn btn-ghost" type="button" data-act="addmsg">Add Message</button>' +
              '</div>' +
            '</div>' +

            '<div class="sbx-section">' +
              '<div class="sbx-row sbx-row-tight" style="justify-content:space-between;">' +
                '<div>' +
                  '<div class="sbx-h3" style="margin:0;">Sources & Metadata</div>' +
                  '<div class="sbx-small">Assume all sources exist. Put any shape of JSON.</div>' +
                '</div>' +
                '<button class="btn btn-ghost" type="button" data-act="togsrc" id="sbx-t-togsrc"></button>' +
              '</div>' +
              '<div id="sbx-t-srcwrap">' +
                '<div class="sbx-h3">Chat Metadata (JSON)</div>' +
                '<textarea class="inp sbx-ta sbx-ta-mono" id="sbx-t-chatmeta" rows="4"></textarea>' +
                '<div class="sbx-muted" id="sbx-t-metaerr" style="margin-top:6px;"></div>' +
                '<div class="sbx-h3">Sources (JSON)</div>' +
                '<textarea class="inp sbx-ta sbx-ta-mono" id="sbx-t-sources" rows="8"></textarea>' +
                '<div class="sbx-muted" id="sbx-t-srcerr" style="margin-top:6px;"></div>' +
              '</div>' +
            '</div>' +

          '</div>' +

          // RIGHT: output
          '<div class="sbx-col">' +
            '<div class="sbx-section">' +
              '<div class="sbx-h3">Results & Trace</div>' +
              '<pre class="sbx-pre" id="sbx-t-log" style="min-height:520px;background:#111;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.12);"></pre>' +
            '</div>' +
          '</div>' +

        '</div>' +
      '</div>';

    function $(sel) { return host.querySelector(sel); }
    function save() { api.saveData(); }

    function setBtnSources() {
      var btn = $('#sbx-t-togsrc');
      if (!btn) return;
      btn.textContent = tstate.sourcesOpen ? 'Collapse' : 'Expand';
    }

    function setSourcesOpen() {
      var wrap = $('#sbx-t-srcwrap');
      if (wrap) wrap.style.display = tstate.sourcesOpen ? '' : 'none';
      setBtnSources();
    }

    function renderMsgs() {
      var wrap = $('#sbx-t-msgs');
      if (!wrap) return;

      if (!tstate.messages.length) {
        wrap.innerHTML = '<div class="sbx-muted">(no messages yet)</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < tstate.messages.length; i++) {
        html +=
          '<div class="sbx-rowcard sbx-rowcard-tight" data-mid="' + i + '">' +
            '<div class="sbx-row sbx-row-tight">' +
              '<span class="sbx-chip">Msg ' + (i + 1) + '</span>' +
              '<span class="sbx-muted" style="flex:1;">(treated as user text for now)</span>' +
              '<button class="btn btn-ghost" type="button" data-act="rmmsg">Remove</button>' +
            '</div>' +
            '<textarea class="inp sbx-ta" data-act="editmsg" rows="2"></textarea>' +
          '</div>';
      }
      wrap.innerHTML = html;

      var cards = wrap.querySelectorAll('[data-mid]');
      for (var c = 0; c < cards.length; c++) {
        (function () {
          var card = cards[c];
          var idx = parseInt(card.getAttribute('data-mid'), 10);
          var ta = card.querySelector('textarea');
          if (ta) {
            ta.value = toStr(tstate.messages[idx] && tstate.messages[idx].text);
            ta.oninput = function () {
              tstate.messages[idx].text = ta.value;
              save();
            };
          }
          var btn = card.querySelector('[data-act="rmmsg"]');
          if (btn) {
            btn.onclick = function () {
              tstate.messages.splice(idx, 1);
              save();
              renderMsgs();
            };
          }
        })();
      }
    }

    function bindInputs() {
      var p = $('#sbx-t-personality');
      var s = $('#sbx-t-scenario');
      var e = $('#sbx-t-examples');
      var m = $('#sbx-t-memory');
      var cm = $('#sbx-t-chatmeta');
      var src = $('#sbx-t-sources');

      if (p) { p.value = tstate.personality; p.oninput = function () { tstate.personality = p.value; save(); }; }
      if (s) { s.value = tstate.scenario; s.oninput = function () { tstate.scenario = s.value; save(); }; }
      if (e) { e.value = tstate.example_dialogs; e.oninput = function () { tstate.example_dialogs = e.value; save(); }; }

      if (m) { m.value = tstate.memoryJson; m.oninput = function () { tstate.memoryJson = m.value; save(); }; }
      if (cm) { cm.value = tstate.chatMetaJson; cm.oninput = function () { tstate.chatMetaJson = cm.value; save(); }; }
      if (src) { src.value = tstate.sourcesJson; src.oninput = function () { tstate.sourcesJson = src.value; save(); }; }
    }

    function showErr(id, msg) {
      var el = $(id);
      if (!el) return;
      el.textContent = msg ? ('⚠ ' + msg) : '';
    }

    function parseJsonOrErr(text, errId, fallback) {
      text = toStr(text);
      if (!text.trim()) return fallback;

      try {
        var v = JSON.parse(text);
        showErr(errId, '');
        return v;
      } catch (e) {
        showErr(errId, e && e.message ? e.message : 'Invalid JSON');
        return null;
      }
    }

    function runTest() {
      // Ensure we save latest in-memory UI (in case)
      save();

      var d = api.getData();
      var appState = d.appState || { lists: [], derived: [], blocks: [] };

      var mem = parseJsonOrErr(tstate.memoryJson, '#sbx-t-memerr', {});
      if (mem === null) return;

      var meta = parseJsonOrErr(tstate.chatMetaJson, '#sbx-t-metaerr', { public_message_count: 0 });
      if (meta === null) return;

      var sources = parseJsonOrErr(tstate.sourcesJson, '#sbx-t-srcerr', {});
      if (sources === null) return;

      // Build context via TestCore
      var ctx = SBX.TestCore.buildContext({
        personality: tstate.personality,
        scenario: tstate.scenario,
        example_dialogs: tstate.example_dialogs,
        memoryJson: JSON.stringify(mem),
        messages: tstate.messages,
        chatMeta: meta,
        sources: sources
      });

      // Make sure message_count is sane if user left it 0
      if (!ctx.chat.chat_metadata) ctx.chat.chat_metadata = {};
      if (typeof ctx.chat.chat_metadata.public_message_count !== 'number' || ctx.chat.chat_metadata.public_message_count <= 0) {
        ctx.chat.chat_metadata.public_message_count = ctx.chat.last_messages.length;
      }

      // Run
      var result = SBX.TestRunner.run(appState, ctx, {});
      tstate.lastLog = result.log;
      save();

      var out = $('#sbx-t-log');
      if (out) out.textContent = result.log;
    }

    function resetAll() {
      tstate.personality = '';
      tstate.scenario = '';
      tstate.example_dialogs = '';
      tstate.memoryJson = '{}';
      tstate.chatMetaJson = '{"public_message_count":0}';
      tstate.sourcesJson = '{}';
      tstate.messages = [];
      tstate.lastLog = '';
      save();

      bindInputs();
      renderMsgs();
      setSourcesOpen();

      var out = $('#sbx-t-log');
      if (out) out.textContent = '';
      showErr('#sbx-t-memerr', '');
      showErr('#sbx-t-metaerr', '');
      showErr('#sbx-t-srcerr', '');
    }

    // Wire main buttons via host click
    host.onclick = function (ev) {
      var act = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-act') : '';
      if (!act) return;

      if (act === 'addmsg') {
        tstate.messages.push({ text: '' });
        save();
        renderMsgs();
      } else if (act === 'run') {
        runTest();
      } else if (act === 'reset') {
        resetAll();
      } else if (act === 'togsrc') {
        tstate.sourcesOpen = !tstate.sourcesOpen;
        save();
        setSourcesOpen();
      }
    };

    // initial paint
    bindInputs();
    renderMsgs();
    setSourcesOpen();

    // restore last log
    var out = $('#sbx-t-log');
    if (out) out.textContent = toStr(tstate.lastLog);

    return {
      refresh: function () {
        // no-op for now, but shell can call it
      }
    };
  }

  SBX.Advanced.Test.mount = mount;

})(window);

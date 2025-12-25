(function (root) {
  'use strict';

  if (!root.Panels || !root.Panels.register) {
    throw new Error('lorebook.panel.js requires panels.registry.js loaded first');
  }

  /* ========================= HELPERS ========================= */

  function $(id) { return document.getElementById(id); }
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function esc(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function lsGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : v; }
    catch (_e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (_e) { }
  }

  // Walk up DOM tree to find node with a given attribute (ES5-safe replacement for closest())
  function findAttrNode(start, rootEl, attr) {
    var n = start;
    while (n && n !== rootEl) {
      if (n.getAttribute && n.getAttribute(attr) != null) return n;
      n = n.parentNode;
    }
    return null;
  }

  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  function clampInt(v, min, max) {
    v = parseInt(v, 10);
    if (isNaN(v)) v = min;
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
  }

  // Split by commas or newlines, trimming empties
  function parseKeywords(raw) {
    var s = String(raw || '');
    // Normalize newlines to commas, then split on commas
    s = s.replace(/\r/g, '').replace(/\n/g, ',');
    var parts = s.split(',');
    var out = [];
    var seen = {};
    for (var i = 0; i < parts.length; i++) {
      var t = trim(parts[i]);
      if (!t) continue;
      // preserve original token, but de-dupe case-insensitively for UI warnings
      var key = t.toLowerCase();
      if (!seen[key]) {
        out.push(t);
        seen[key] = true;
      }
    }
    return out;
  }

  function makeId() {
    // simple stable-ish id; fine for localStorage
    return 'lb_' + (new Date().getTime()) + '_' + Math.floor(Math.random() * 1000000);
  }

  /* ========================= CONSTANTS / UI STATE ========================= */

  var UI = {
    activeIndex: 0,
    sections: {} // per-entry: { basics:true, triggers:true, content:true, notes:false }
  };

  function getSectionState(i) {
    if (!UI.sections[i]) UI.sections[i] = { basics: true, triggers: true, content: true, notes: false };
    return UI.sections[i];
  }

  function entryTitle(e, idx) {
    var t = e && e.title ? trim(e.title) : '';
    return 'Entry ' + (idx + 1) + ' — ' + (t ? t : '(Unnamed)');
  }

  function targetLabel(t) {
    return (t === 'personality') ? '→ Personality' : '→ Scenario';
  }

  /* ========================= STATE ========================= */

  function ensureState(S) {
    if (!S.data) S.data = {};
    if (!S.data.lorebook) {
      S.data.lorebook = {
        enabled: true,
        activeIndex: 0,
        defaults: {
          caseSensitive: false,  // OFF by default
          wholeWord: true,       // ON by default
          defaultTarget: 'scenario'
        },
        entries: []
      };
    }
    var cfg = S.data.lorebook;
    if (!cfg.defaults) cfg.defaults = {};
    if (typeof cfg.defaults.caseSensitive !== 'boolean') cfg.defaults.caseSensitive = false;
    if (typeof cfg.defaults.wholeWord !== 'boolean') cfg.defaults.wholeWord = true;
    if (cfg.defaults.defaultTarget !== 'scenario' && cfg.defaults.defaultTarget !== 'personality') {
      cfg.defaults.defaultTarget = 'scenario';
    }
    if (!isArr(cfg.entries)) cfg.entries = [];
    if (typeof cfg.activeIndex !== 'number' || isNaN(cfg.activeIndex)) cfg.activeIndex = 0;
    if (cfg.activeIndex < 0) cfg.activeIndex = 0;
    if (cfg.activeIndex >= cfg.entries.length) cfg.activeIndex = cfg.entries.length ? (cfg.entries.length - 1) : 0;
  }

  function loadState(S) {
    ensureState(S);
    var raw = lsGet('studio.data.lorebook', '');
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        S.data.lorebook = p;
        ensureState(S);
      }
    } catch (_e) { }
  }

  function saveState(S) {
    lsSet('studio.data.lorebook', JSON.stringify(S.data.lorebook));
  }

  function newEntry(defaultTarget) {
    return {
      id: makeId(),
      enabled: true,
      title: '',
      target: (defaultTarget === 'personality') ? 'personality' : 'scenario',
      keywords: '',
      text: '',
      notes: ''
    };
  }

  function setActive(S, idx) {
    var cfg = S.data.lorebook;
    idx = clampInt(idx, 0, cfg.entries.length ? cfg.entries.length - 1 : 0);
    UI.activeIndex = idx;
    cfg.activeIndex = idx;
    saveState(S);
  }

  /* ========================= VALIDATION (UI warnings) ========================= */

  function validateCfg(cfg) {
    var warnings = [];
    var errors = [];

    // Basic per-entry checks + duplicate keyword detection across enabled entries
    var keywordMap = {}; // keyLower -> [{entryIdx, entryId, title, target}]
    for (var i = 0; i < cfg.entries.length; i++) {
      var e = cfg.entries[i];
      if (!e) continue;

      var title = trim(e.title);
      var kw = parseKeywords(e.keywords);
      var txt = trim(e.text);

      if (e.enabled) {
        if (!kw.length) errors.push('Entry ' + (i + 1) + ' has no keywords (will never trigger).');
        if (!txt) warnings.push('Entry ' + (i + 1) + ' has no text (triggers but writes nothing).');
      }

      // collect keywords for collisions (enabled only)
      if (e.enabled && kw.length) {
        for (var k = 0; k < kw.length; k++) {
          var keyLower = kw[k].toLowerCase();
          if (!keywordMap[keyLower]) keywordMap[keyLower] = [];
          keywordMap[keyLower].push({
            entryIdx: i,
            entryId: e.id,
            title: title || ('Entry ' + (i + 1)),
            target: e.target || 'scenario'
          });
        }
      }
    }

    for (var key in keywordMap) {
      if (!keywordMap.hasOwnProperty(key)) continue;
      var arr = keywordMap[key];
      if (arr.length > 1) {
        // If multiple enabled entries share same keyword, warn (especially if targets differ)
        var targets = {};
        for (var j = 0; j < arr.length; j++) targets[arr[j].target] = true;

        var targetList = [];
        for (var t in targets) if (targets.hasOwnProperty(t)) targetList.push(t);

        warnings.push('Keyword "' + key + '" appears in multiple enabled entries (targets: ' + targetList.join(', ') + ').');
      }
    }

    return { warnings: warnings, errors: errors };
  }

  /* ========================= EXPORT (ES5 script generator) ========================= */

  function jsStr(s) {
    s = String(s == null ? '' : s);
    s = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    return '"' + s + '"';
  }

  function emitEntries(cfg) {
    var out = '[';
    for (var i = 0; i < cfg.entries.length; i++) {
      var e = cfg.entries[i];
      if (!e) continue;
      if (i) out += ',';
      out += '{';
      out += 'id:' + jsStr(e.id || ('e' + i)) + ',';
      out += 'enabled:' + (e.enabled ? 'true' : 'false') + ',';
      out += 'target:' + jsStr((e.target === 'personality') ? 'personality' : 'scenario') + ',';
      out += 'keywords:' + jsStr(String(e.keywords || '')) + ',';
      out += 'text:' + jsStr(String(e.text || '')) + '';
      out += '}';
    }
    out += ']';
    return out;
  }

  function generateScript(cfg) {
    if (!cfg || !cfg.enabled) return '';
    var hasActive = false;
    for (var i = 0; i < (cfg.entries || []).length; i++) {
      if (cfg.entries[i] && cfg.entries[i].enabled) { hasActive = true; break; }
    }
    if (!hasActive) return '';

    // ES5-only output. User supplies plain keywords; script compiles safe regex.
    var s = '';
    s += '/* === LOREBOOK (Basic, Generated) ======================================= */\n\n';
    s += 'var LB_CFG = {\n';
    s += '  enabled: true,\n';
    s += '  caseSensitive: ' + (cfg.defaults.caseSensitive ? 'true' : 'false') + ',\n';
    s += '  wholeWord: ' + (cfg.defaults.wholeWord ? 'true' : 'false') + ',\n';
    s += '  entries: ' + emitEntries(cfg) + '\n';
    s += '};\n\n';

    s += '(function(){\n';
    s += '  if (!LB_CFG || !LB_CFG.enabled) return;\n';
    s += '  if (typeof context === \"undefined\" || !context || !context.chat) return;\n';
    s += '  var msg = context.chat.last_message;\n';
    s += '  if (msg == null) msg = \"\";\n';
    s += '  msg = String(msg);\n';
    s += '  if (!msg) return;\n';
    s += '  if (!context.character) context.character = {};\n\n';
    s += '  var entries = LB_CFG.entries || [];\n';
    s += '  for (var i=0;i<entries.length;i++){\n';
    s += '    var e = entries[i];\n';
    s += '    if (!e || !e.enabled) continue;\n';
    s += '    var tokens = SBX_R.parseKeywords(e.keywords);\n';
    s += '    if (!tokens.length) continue;\n';
    s += '    var re = SBX_R.buildRegex(tokens, LB_CFG.wholeWord, LB_CFG.caseSensitive);\n';
    s += '    if (!re) continue;\n';
    s += '    if (re.test(msg)) {\n';
    s += '      var target = (e.target === \"personality\") ? \"character.personality\" : \"character.scenario\";\n';
    s += '      SBX_R.append(context, target, e.text, \"[LB:\" + e.id + \"]\", true);\n';
    s += '    }\n';
    s += '  }\n';
    s += '})();\n';

    return s;
  }

  /* ========================= UI ========================= */

  function renderSectionHeader(label, key, open) {
    var idx = UI.activeIndex;
    return (
      '<button class="lb-sec-h" type="button" data-lb-sec="' + idx + ':' + key + '">' +
      '<span class="lb-caret" aria-hidden="true">' + (open ? '▾' : '▸') + '</span>' +
      '<span class="lb-sec-title">' + esc(label) + '</span>' +
      '</button>'
    );
  }

  function render(rootEl, S) {
    var cfg = S.data.lorebook;

    UI.activeIndex = cfg.activeIndex || 0;
    if (UI.activeIndex >= cfg.entries.length) UI.activeIndex = cfg.entries.length ? (cfg.entries.length - 1) : 0;

    var active = cfg.entries[UI.activeIndex] || null;
    var diag = validateCfg(cfg);

    var html = '';
    html += '<div class="lb-shell">';

    // Top controls
    html += '  <div class="eng-block">';
    html += '    <div class="lb-top-row">';
    html += '      <div class="lb-top-left">';
    html += '        <div class="eng-h">Lorebook (Basic)</div>';
    html += '        <div class="eng-muted">Keyword-triggered inserts. Tool compiles safe regex. Writes → Scenario or Personality.</div>';
    html += '      </div>';
    html += '      <div class="lb-top-right">';
    html += '        <label class="pill pill-warn" style="cursor:pointer;"><input type="checkbox" id="lb-case" ' + (cfg.defaults.caseSensitive ? 'checked' : '') + ' /> Case sensitive</label>';
    html += '        <label class="pill pill-ok" style="cursor:pointer;"><input type="checkbox" id="lb-word" ' + (cfg.defaults.wholeWord ? 'checked' : '') + ' /> Whole word</label>';
    html += '        <select class="inp lb-sel" id="lb-defaultTarget">';
    html += '          <option value="scenario"' + (cfg.defaults.defaultTarget === 'scenario' ? ' selected' : '') + '>New → Scenario</option>';
    html += '          <option value="personality"' + (cfg.defaults.defaultTarget === 'personality' ? ' selected' : '') + '>New → Personality</option>';
    html += '        </select>';
    html += '        <button class="btn btn-ghost" type="button" id="lb-add">+ Add Entry</button>';
    html += '      </div>';
    html += '    </div>';
    html += '  </div>';

    // Body: left tabs + right editor
    html += '  <div class="lb-body">';

    // Left entry tabs
    html += '    <div class="lb-tabs eng-block">';
    html += '      <div class="eng-h">Entries</div>';
    html += '      <div class="lb-tablist">';

    if (!cfg.entries.length) {
      html += '        <div class="eng-muted" style="margin-bottom:12px;">(no entries yet)</div>' +
        '        <button class="btn btn-primary" type="button" id="lb-add-empty">+ Add Your First Entry</button>';
    } else {
      for (var i = 0; i < cfg.entries.length; i++) {
        var e = cfg.entries[i];
        var on = !!(e && e.enabled);
        var kwCount = parseKeywords(e.keywords).length;
        html += '        <button class="lb-tab' + (i === UI.activeIndex ? ' is-active' : '') + '" type="button" data-lb-tab="' + i + '">';
        html += '          <div class="lb-tab-top">';
        html += '            <span class="lb-dot ' + (on ? 'on' : 'off') + '" aria-hidden="true" title="' + (on ? 'Enabled' : 'Disabled') + '"></span>';
        html += '            <span class="lb-tab-name">' + esc(entryTitle(e, i)) + '</span>';
        html += '          </div>';
        html += '          <div class="lb-tab-meta">';
        html += '            <span class="lb-chip" title="Target field">' + esc(targetLabel(e.target)) + '</span>';
        html += '            <span class="lb-meta">' + esc(String(kwCount)) + ' keywords</span>';
        html += '          </div>';
        html += '        </button>';
      }
    }

    html += '      </div>';
    html += '    </div>';

    // Right editor
    html += '    <div class="lb-editor eng-block">';

    if (!active) {
      html += '      <div class="eng-h">Editor</div>';
      html += '      <div class="eng-muted" style="margin-bottom:12px;">Add an entry to begin.</div>';
    } else {
      var sec = getSectionState(UI.activeIndex);

      html += '      <div class="lb-editor-head">';
      html += '        <div class="eng-h">' + esc(entryTitle(active, UI.activeIndex)) + '</div>';
      html += '        <div class="lb-editor-actions">';
      html += '          <label class="pill pill-ok" style="cursor:pointer;"><input type="checkbox" data-lb-en="' + UI.activeIndex + '" ' + (active.enabled ? 'checked' : '') + ' /> Enabled</label>';
      html += '          <button class="btn btn-ghost lb-mini" type="button" data-lb-dup="' + UI.activeIndex + '">Duplicate</button>';
      html += '          <button class="btn btn-danger lb-mini" type="button" data-lb-del="' + UI.activeIndex + '">Remove</button>';
      html += '        </div>';
      html += '      </div>';

      html += renderSectionHeader('Basics', 'basics', sec.basics);
      if (sec.basics) {
        html += '      <div class="lb-section">';
        html += '        <label class="eng-lab">Title</label>';
        html += '        <input class="inp" data-lb-title="' + UI.activeIndex + '" value="' + esc(active.title || '') + '" />';
        html += '        <div class="lb-row2">';
        html += '          <div>';
        html += '            <label class="eng-lab">Target</label>';
        html += '            <select class="inp" data-lb-target="' + UI.activeIndex + '">';
        html += '              <option value="scenario"' + (active.target !== 'personality' ? ' selected' : '') + '>Scenario</option>';
        html += '              <option value="personality"' + (active.target === 'personality' ? ' selected' : '') + '>Personality</option>';
        html += '            </select>';
        html += '          </div>';
        html += '          <div class="eng-muted" style="align-self:end;">This entry will append to the selected field.</div>';
        html += '        </div>';
        html += '      </div>';
      }

      html += renderSectionHeader('Triggers', 'triggers', sec.triggers);
      if (sec.triggers) {
        html += '      <div class="lb-section">';
        html += '        <label class="eng-lab">Keywords (commas or new lines)</label>';
        html += '        <textarea class="inp lb-ta" rows="4" data-lb-kw="' + UI.activeIndex + '">' + esc(active.keywords || '') + '</textarea>';
        html += '        <div class="eng-muted">Example: <b>rut, heat</b> or one per line. Tool compiles safe regex. Whole-word prevents <b>cat</b> matching <b>catgirl</b>.</div>';
        html += '      </div>';
      }

      html += renderSectionHeader('Content', 'content', sec.content);
      if (sec.content) {
        html += '      <div class="lb-section">';
        html += '        <label class="eng-lab">Insert Text</label>';
        html += '        <textarea class="inp lb-ta" rows="6" data-lb-text="' + UI.activeIndex + '">' + esc(active.text || '') + '</textarea>';
        html += '      </div>';
      }

      html += renderSectionHeader('Notes', 'notes', sec.notes);
      if (sec.notes) {
        html += '      <div class="lb-section">';
        html += '        <label class="eng-lab">Notes (not exported)</label>';
        html += '        <textarea class="inp lb-ta" rows="3" data-lb-notes="' + UI.activeIndex + '">' + esc(active.notes || '') + '</textarea>';
        html += '      </div>';
      }

      // Preview
      html += '      <div class="lb-preview">';
      html += '        <div class="lb-preview-head">';
      html += '          <div class="eng-h" style="margin:0;">Generated Script (preview)</div>';
      html += '          <button class="btn btn-ghost lb-mini" type="button" id="lb-copy">Copy</button>';
      html += '        </div>';
      html += '        <textarea class="inp lb-ta" rows="7" id="lb-preview" readonly></textarea>';
      html += '      </div>';
    }

    html += '    </div>'; // editor
    html += '  </div>'; // body

    // Validation block (bottom, always visible)
    html += '  <div class="eng-block">';
    html += '    <div class="eng-h">Lorebook Checks</div>';
    html += '    <div class="eng-muted">Basic warnings to help you spot overlapping triggers and empty entries.</div>';
    html += '    <div class="lb-checks">';
    html += '      <div class="lb-check-col">';
    html += '        <div class="lb-check-h">Errors</div>';
    if (!diag.errors.length) html += '        <div class="eng-muted">(none)</div>';
    else {
      html += '        <ul class="eng-ul">';
      for (var ei = 0; ei < diag.errors.length; ei++) html += '          <li>' + esc(diag.errors[ei]) + '</li>';
      html += '        </ul>';
    }
    html += '      </div>';
    html += '      <div class="lb-check-col">';
    html += '        <div class="lb-check-h">Warnings</div>';
    if (!diag.warnings.length) html += '        <div class="eng-muted">(none)</div>';
    else {
      html += '        <ul class="eng-ul">';
      for (var wi = 0; wi < diag.warnings.length; wi++) html += '          <li>' + esc(diag.warnings[wi]) + '</li>';
      html += '        </ul>';
    }
    html += '      </div>';
    html += '    </div>';
    html += '  </div>';

    html += '</div>'; // shell

    rootEl.innerHTML = html;

    // Wire top toggles
    var cse = $('lb-case');
    if (cse) cse.onchange = function () {
      cfg.defaults.caseSensitive = !!cse.checked;
      saveState(S);
      updatePreview();
    };

    var ww = $('lb-word');
    if (ww) ww.onchange = function () {
      cfg.defaults.wholeWord = !!ww.checked;
      saveState(S);
      updatePreview();
    };

    var dt = $('lb-defaultTarget');
    if (dt) dt.onchange = function () {
      var v = dt.value;
      cfg.defaults.defaultTarget = (v === 'personality') ? 'personality' : 'scenario';
      saveState(S);
    };

    var add = $('lb-add');
    if (add) add.onclick = function () {
      cfg.entries.push(newEntry(cfg.defaults.defaultTarget));
      setActive(S, cfg.entries.length - 1);
      saveState(S);
      render(rootEl, S);
    };

    var addEmpty = $('lb-add-empty');
    if (addEmpty) addEmpty.onclick = function () {
      if (add) add.click();
    };

    var copyBtn = $('lb-copy');
    if (copyBtn) copyBtn.onclick = function () {
      var ta = $('lb-preview');
      if (!ta) return;
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (_e) { }
    };

    // Delegated clicks
    rootEl.onclick = function (ev) {
      ev = ev || window.event;
      var t = ev.target || ev.srcElement;

      var tabNode = findAttrNode(t, rootEl, 'data-lb-tab');
      if (tabNode) {
        var idx = parseInt(tabNode.getAttribute('data-lb-tab'), 10);
        if (!isNaN(idx)) {
          setActive(S, idx);
          render(rootEl, S);
        }
        return;
      }

      var secNode = findAttrNode(t, rootEl, 'data-lb-sec');
      if (secNode) {
        var p = String(secNode.getAttribute('data-lb-sec')).split(':');
        var vi = parseInt(p[0], 10);
        var key = p[1];
        if (!isNaN(vi) && key) {
          var st = getSectionState(vi);
          st[key] = !st[key];
          render(rootEl, S);
        }
        return;
      }

      var delNode = findAttrNode(t, rootEl, 'data-lb-del');
      if (delNode) {
        var di = parseInt(delNode.getAttribute('data-lb-del'), 10);
        if (!isNaN(di)) {
          cfg.entries.splice(di, 1);
          if (cfg.activeIndex >= cfg.entries.length) cfg.activeIndex = cfg.entries.length ? (cfg.entries.length - 1) : 0;
          saveState(S);
          render(rootEl, S);
        }
        return;
      }

      var dupNode = findAttrNode(t, rootEl, 'data-lb-dup');
      if (dupNode) {
        var si = parseInt(dupNode.getAttribute('data-lb-dup'), 10);
        if (!isNaN(si) && cfg.entries[si]) {
          var src = cfg.entries[si];
          var copy = {
            id: makeId(),
            enabled: src.enabled,
            title: (src.title ? (String(src.title) + ' (copy)') : ''),
            target: src.target === 'personality' ? 'personality' : 'scenario',
            keywords: String(src.keywords || ''),
            text: String(src.text || ''),
            notes: String(src.notes || '')
          };
          cfg.entries.splice(si + 1, 0, copy);
          cfg.activeIndex = si + 1;
          saveState(S);
          render(rootEl, S);
        }
      }
    };

    // Delegated changes
    rootEl.onchange = function (ev) {
      ev = ev || window.event;
      var t = ev.target || ev.srcElement;
      if (!t || !t.getAttribute) return;

      function eAt(i) { return cfg.entries[i]; }

      // enabled toggle
      var en = t.getAttribute('data-lb-en');
      if (en != null) {
        var i = parseInt(en, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).enabled = !!t.checked;
          saveState(S);
          updatePreview();
          render(rootEl, S);
        }
        return;
      }

      var title = t.getAttribute('data-lb-title');
      if (title != null) {
        i = parseInt(title, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).title = t.value;
          saveState(S);
          updatePreview();
          render(rootEl, S);
        }
        return;
      }

      var target = t.getAttribute('data-lb-target');
      if (target != null) {
        i = parseInt(target, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).target = (t.value === 'personality') ? 'personality' : 'scenario';
          saveState(S);
          updatePreview();
          render(rootEl, S);
        }
        return;
      }

      var kw = t.getAttribute('data-lb-kw');
      if (kw != null) {
        i = parseInt(kw, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).keywords = t.value;
          saveState(S);
          updatePreview();
          // don’t full rerender on every edit; but validations update on rerender.
          // keep it simple: rerender after change event (blur/change), not each keypress.
          render(rootEl, S);
        }
        return;
      }

      var txt = t.getAttribute('data-lb-text');
      if (txt != null) {
        i = parseInt(txt, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).text = t.value;
          saveState(S);
          updatePreview();
        }
        return;
      }

      var notes = t.getAttribute('data-lb-notes');
      if (notes != null) {
        i = parseInt(notes, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).notes = t.value;
          saveState(S);
        }
      }
    };

    function updatePreview() {
      var prev = $('lb-preview');
      if (!prev) return;
      var code = generateScript(cfg);
      if (!code) {
        prev.value = '/* Lorebook module is either disabled or has no enabled entries. */';
        return;
      }
      prev.value = code;
    }
    updatePreview();
  }

  /* ========================= PANEL REGISTRATION ========================= */

  root.Panels.register({
    id: 'lorebook',

    mount: function (rootEl, S) {
      ensureState(S);
      loadState(S);
      // CSS is now global (panels.css), no injection here.
      render(rootEl, S);
    },

    getExportBlocks: function (S) {
      ensureState(S);
      var cfg = S.data.lorebook;
      return [{
        kind: 'script',
        id: 'lorebook.basic',
        code: generateScript(cfg)
      }];
    },

    // Declares only the write targets actually used by enabled entries
    getWriteTargets: function (S) {
      ensureState(S);
      var cfg = S.data.lorebook;
      var hasScenario = false;
      var hasPersonality = false;

      for (var i = 0; i < cfg.entries.length; i++) {
        var e = cfg.entries[i];
        if (!e || !e.enabled) continue;
        if ((e.target || 'scenario') === 'personality') hasPersonality = true;
        else hasScenario = true;
      }

      var out = [];
      if (hasScenario) out.push('context.character.scenario');
      if (hasPersonality) out.push('context.character.personality');
      return out;
    },

    getRuleSpecs: function (S) {
      ensureState(S);
      var cfg = S.data.lorebook;

      var specs = [];
      var entries = cfg.entries || [];

      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e) continue;

        specs.push({
          id: 'lorebook:' + (e.id || ('e' + i)),
          moduleId: 'lorebook',
          enabled: !!e.enabled,
          label: entryTitle(e, i),

          // “why does this fire?”
          match: {
            type: 'keyword',
            keywordsRaw: String(e.keywords || ''),
            caseSensitive: !!cfg.defaults.caseSensitive,
            wholeWord: !!cfg.defaults.wholeWord
          },

          // “what does it do?”
          write: {
            target: (e.target === 'personality') ? 'context.character.personality' : 'context.character.scenario',
            marker: '[LB:' + (e.id || ('e' + i)) + ']',
            text: String(e.text || '')
          }
        });
      }

      return specs;
    }
  });

})(window);

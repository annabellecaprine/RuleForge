/* memory.panel.js — Memory (Basic) (ES5)
 * - Lorebook-style layout (lb-*) with global panels.css (NO per-panel CSS injection)
 * - Keyword-triggered persistent facts with one-time marker option
 * - Writes to context.character.personality OR context.character.scenario
 * - Bottom preview: paste-ready JanitorAI ES5 snippet
 */
(function (root) {
  'use strict';

  if (!root.Panels || !root.Panels.register) {
    throw new Error('memory.panel.js requires panels.registry.js loaded first');
  }

  /* ========================= HELPERS ========================= */

  function $(id) { return document.getElementById(id); }
  function q(sel, el) { return (el || document).querySelector(sel); }
  function qa(sel, el) { return (el || document).querySelectorAll(sel); }

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function esc(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function lsGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : v; }
    catch (_e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (_e) { }
  }

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
    s = s.replace(/\r/g, '').replace(/\n/g, ',');
    var parts = s.split(',');
    var out = [];
    var seen = {};
    for (var i = 0; i < parts.length; i++) {
      var t = trim(parts[i]);
      if (!t) continue;
      var key = t.toLowerCase();
      if (!seen[key]) { out.push(t); seen[key] = true; }
    }
    return out;
  }

  function makeId() {
    return 'mem_' + (new Date().getTime()) + '_' + Math.floor(Math.random() * 1000000);
  }

  /* ========================= UI STATE ========================= */

  var UI = {
    activeIndex: 0,
    sections: {} // per-entry: { basics:true, triggers:true, write:true, notes:false }
  };

  function getSectionState(i) {
    if (!UI.sections[i]) UI.sections[i] = { basics: true, triggers: true, write: true, notes: false };
    return UI.sections[i];
  }

  function entryTitle(e, idx) {
    var t = e && e.title ? trim(e.title) : '';
    return 'Memory ' + (idx + 1) + (t ? (' — ' + t) : ' — (Unnamed)');
  }

  function targetLabel(t) {
    return (t === 'scenario') ? '→ Scenario' : '→ Personality';
  }

  /* ========================= STATE ========================= */

  function ensureState(S) {
    if (!S.data) S.data = {};
    if (!S.data.memory) {
      S.data.memory = {
        enabled: true,
        activeIndex: 0,
        defaults: {
          caseSensitive: false,
          wholeWord: true,
          defaultTarget: 'personality',
          oneTime: true
        },
        entries: []
      };
    }

    var cfg = S.data.memory;
    if (typeof cfg.enabled !== 'boolean') cfg.enabled = true;

    if (!cfg.defaults) cfg.defaults = {};
    if (typeof cfg.defaults.caseSensitive !== 'boolean') cfg.defaults.caseSensitive = false;
    if (typeof cfg.defaults.wholeWord !== 'boolean') cfg.defaults.wholeWord = true;
    if (typeof cfg.defaults.oneTime !== 'boolean') cfg.defaults.oneTime = true;

    if (cfg.defaults.defaultTarget !== 'scenario' && cfg.defaults.defaultTarget !== 'personality') {
      cfg.defaults.defaultTarget = 'personality';
    }

    if (!isArr(cfg.entries)) cfg.entries = [];
    if (typeof cfg.activeIndex !== 'number' || isNaN(cfg.activeIndex)) cfg.activeIndex = 0;
    if (cfg.activeIndex < 0) cfg.activeIndex = 0;
    if (cfg.activeIndex >= cfg.entries.length) cfg.activeIndex = cfg.entries.length ? (cfg.entries.length - 1) : 0;
  }

  function loadState(S) {
    ensureState(S);
    var raw = lsGet('studio.data.memory', '');
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        S.data.memory = p;
        ensureState(S);
      }
    } catch (_e) { }
  }

  function saveState(S) {
    lsSet('studio.data.memory', JSON.stringify(S.data.memory));
  }

  function newEntry(defaultTarget) {
    return {
      id: makeId(),
      enabled: true,
      title: '',
      target: (defaultTarget === 'scenario') ? 'scenario' : 'personality',
      keywords: '',
      memoryText: '',
      notes: ''
    };
  }

  function setActive(S, idx) {
    var cfg = S.data.memory;
    idx = clampInt(idx, 0, cfg.entries.length ? cfg.entries.length - 1 : 0);
    UI.activeIndex = idx;
    cfg.activeIndex = idx;
    saveState(S);
  }

  /* ========================= VALIDATION ========================= */

  function validateCfg(cfg) {
    var warnings = [];
    var errors = [];

    var keywordMap = {}; // keyLower -> [{idx,title,target}]
    for (var i = 0; i < cfg.entries.length; i++) {
      var e = cfg.entries[i];
      if (!e) continue;

      var kw = parseKeywords(e.keywords);
      var txt = trim(e.memoryText);

      if (cfg.enabled && e.enabled) {
        if (!kw.length) errors.push('Memory ' + (i + 1) + ' has no keywords (will never trigger).');
        if (!txt) warnings.push('Memory ' + (i + 1) + ' has no memory text (triggers but writes nothing).');
      }

      if (cfg.enabled && e.enabled && kw.length) {
        for (var k = 0; k < kw.length; k++) {
          var key = kw[k].toLowerCase();
          if (!keywordMap[key]) keywordMap[key] = [];
          keywordMap[key].push({
            idx: i,
            title: trim(e.title) || ('Memory ' + (i + 1)),
            target: e.target || 'personality'
          });
        }
      }
    }

    for (var kk in keywordMap) {
      if (!keywordMap.hasOwnProperty(kk)) continue;
      var arr = keywordMap[kk];
      if (arr.length > 1) {
        var targets = {};
        for (var j = 0; j < arr.length; j++) targets[arr[j].target] = true;
        var tlist = [];
        for (var t in targets) if (targets.hasOwnProperty(t)) tlist.push(t);
        warnings.push('Keyword "' + kk + '" appears in multiple enabled memories (targets: ' + tlist.join(', ') + ').');
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
    var first = true;
    for (var i = 0; i < cfg.entries.length; i++) {
      var e = cfg.entries[i];
      if (!e) continue;
      if (!first) out += ',';
      first = false;

      out += '{';
      out += 'id:' + jsStr(e.id || ('m' + i)) + ',';
      out += 'enabled:' + (e.enabled ? 'true' : 'false') + ',';
      out += 'target:' + jsStr((e.target === 'scenario') ? 'scenario' : 'personality') + ',';
      out += 'keywords:' + jsStr(String(e.keywords || '')) + ',';
      out += 'memoryText:' + jsStr(String(e.memoryText || '')) + '';
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

    var s = '';
    s += '/* === MEMORY (Basic, Generated) ========================================= */\n\n';
    s += 'var MEM_CFG = {\n';
    s += '  enabled: ' + (cfg.enabled ? 'true' : 'false') + ',\n';
    s += '  caseSensitive: ' + (cfg.defaults.caseSensitive ? 'true' : 'false') + ',\n';
    s += '  wholeWord: ' + (cfg.defaults.wholeWord ? 'true' : 'false') + ',\n';
    s += '  oneTime: ' + (cfg.defaults.oneTime ? 'true' : 'false') + ',\n';
    s += '  entries: ' + emitEntries(cfg) + '\n';
    s += '};\n\n';

    s += '(function(){\n';
    s += '  if (!MEM_CFG.enabled) return;\n';
    s += '  if (typeof context === \"undefined\" || !context || !context.chat) return;\n';
    s += '  var msg = context.chat.last_message;\n';
    s += '  if (msg == null) msg = \"\";\n';
    s += '  msg = String(msg);\n';
    s += '  if (!msg) return;\n';
    s += '  if (!context.character) context.character = {};\n\n';
    s += '  var entries = MEM_CFG.entries || [];\n';
    s += '  for (var i=0;i<entries.length;i++){\n';
    s += '    var e = entries[i];\n';
    s += '    if (!e || !e.enabled) continue;\n';
    s += '    var tokens = SBX_R.parseKeywords(e.keywords);\n';
    s += '    if (!tokens.length) continue;\n';
    s += '    var re = SBX_R.buildRegex(tokens, MEM_CFG.wholeWord, MEM_CFG.caseSensitive);\n';
    s += '    if (!re) continue;\n';
    s += '    if (re.test(msg)) {\n';
    s += '      var target = (e.target === \"scenario\") ? \"character.scenario\" : \"character.personality\";\n';
    s += '      SBX_R.append(context, target, e.memoryText, \"[MEM:\" + e.id + \"]\", MEM_CFG.oneTime);\n';
    s += '    }\n';
    s += '  }\n';
    s += '})();\n';

    return s;
  }

  /* ========================= UI ========================= */

  function renderSectionToggle(label, key, open) {
    var idx = UI.activeIndex;
    return (
      '<button class="btn btn-ghost" type="button" data-mem-sec="' + idx + ':' + key + '" style="width:100%;text-align:left;">' +
      (open ? '▾ ' : '▸ ') + esc(label) +
      '</button>'
    );
  }

  function render(rootEl, S) {
    var cfg = S.data.memory;

    UI.activeIndex = cfg.activeIndex || 0;
    if (UI.activeIndex >= cfg.entries.length) UI.activeIndex = cfg.entries.length ? (cfg.entries.length - 1) : 0;

    var active = cfg.entries[UI.activeIndex] || null;
    var diag = validateCfg(cfg);

    var html = '';
    html += '<div class="lb-shell">';

    // Top controls
    html += '  <div class="eng-block">';
    html += '    <div class="lb-editor-head">';
    html += '      <div>';
    html += '        <div class="eng-h">Memory (Basic)</div>';
    html += '        <div class="eng-muted">Keyword-triggered persistent facts. Compiled safe regex. Writes → Personality (default) or Scenario.</div>';
    html += '      </div>';
    html += '      <div class="lb-editor-actions">';
    html += '        <label class="pill pill-ok" style="cursor:pointer;"><input type="checkbox" id="mem-enabled" ' + (cfg.enabled ? 'checked' : '') + ' /> Enabled</label>';
    html += '        <label class="pill pill-warn" style="cursor:pointer;"><input type="checkbox" id="mem-case" ' + (cfg.defaults.caseSensitive ? 'checked' : '') + ' /> Case sensitive</label>';
    html += '        <label class="pill pill-ok" style="cursor:pointer;"><input type="checkbox" id="mem-word" ' + (cfg.defaults.wholeWord ? 'checked' : '') + ' /> Whole word</label>';
    html += '        <label class="pill pill-ok" style="cursor:pointer;"><input type="checkbox" id="mem-onetime" ' + (cfg.defaults.oneTime ? 'checked' : '') + ' /> One-time</label>';
    html += '        <select class="inp lb-sel" id="mem-defaultTarget">';
    html += '          <option value="personality"' + (cfg.defaults.defaultTarget === 'personality' ? ' selected' : '') + '>New → Personality</option>';
    html += '          <option value="scenario"' + (cfg.defaults.defaultTarget === 'scenario' ? ' selected' : '') + '>New → Scenario</option>';
    html += '        </select>';
    html += '        <button class="btn" type="button" id="mem-add">+ Add Memory</button>';
    html += '      </div>';
    html += '    </div>';
    html += '  </div>';

    // Body (lb layout)
    html += '  <div class="lb-body">';

    // Left tabs
    html += '    <div class="lb-tabs eng-block">';
    html += '      <div class="eng-h">Memories</div>';
    html += '      <div class="lb-tablist" id="mem-tabs">';

    if (!cfg.entries.length) {
      html += '        <div class="eng-muted" style="margin-bottom:12px;">(no memories yet)</div>' +
        '        <button class="btn btn-primary" type="button" id="mem-add-empty">+ Add Your First Memory</button>';
    } else {
      for (var i = 0; i < cfg.entries.length; i++) {
        var e = cfg.entries[i];
        var on = !!(cfg.enabled && e && e.enabled);
        var kwCount = parseKeywords(e.keywords).length;

        html += '        <button class="lb-tab' + (i === UI.activeIndex ? ' is-active' : '') + '" type="button" data-mem-tab="' + i + '">';
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
      html += '      <div class="eng-muted" style="margin-bottom:12px;">Add a memory entry to begin.</div>';
    } else {
      var sec = getSectionState(UI.activeIndex);

      html += '      <div class="lb-editor-head">';
      html += '        <div class="eng-h" style="margin:0;">' + esc(entryTitle(active, UI.activeIndex)) + '</div>';
      html += '        <div class="lb-editor-actions">';
      html += '          <label class="pill pill-ok" style="cursor:pointer;"><input type="checkbox" data-mem-en="' + UI.activeIndex + '" ' + (active.enabled ? 'checked' : '') + ' /> Enabled</label>';
      html += '          <button class="btn btn-ghost lb-mini" type="button" data-mem-dup="' + UI.activeIndex + '">Duplicate</button>';
      html += '          <button class="btn btn-danger lb-mini" type="button" data-mem-del="' + UI.activeIndex + '">Remove</button>';
      html += '        </div>';
      html += '      </div>';

      // Sections (no custom CSS; uses shared buttons + inline spacing)
      html += '<div style="margin-top:12px;">' + renderSectionToggle('Basics', 'basics', sec.basics) + '</div>';
      if (sec.basics) {
        html += '  <div class="card" style="padding:12px; margin-top:10px;">';
        html += '    <label class="eng-lab">Title</label>';
        html += '    <input class="inp" data-mem-title="' + UI.activeIndex + '" value="' + esc(active.title || '') + '" />';
        html += '    <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-top:10px;">';
        html += '      <label class="ctl">Target ';
        html += '        <select class="inp" data-mem-target="' + UI.activeIndex + '">';
        html += '          <option value="personality"' + (active.target !== 'scenario' ? ' selected' : '') + '>Personality</option>';
        html += '          <option value="scenario"' + (active.target === 'scenario' ? ' selected' : '') + '>Scenario</option>';
        html += '        </select>';
        html += '      </label>';
        html += '      <span class="eng-muted" style="font-size:12px;">Memory should usually go to Personality.</span>';
        html += '    </div>';
        html += '  </div>';
      }

      html += '<div style="margin-top:12px;">' + renderSectionToggle('Triggers', 'triggers', sec.triggers) + '</div>';
      if (sec.triggers) {
        html += '  <div class="card" style="padding:12px; margin-top:10px;">';
        html += '    <label class="eng-lab">Keywords (commas or new lines)</label>';
        html += '    <textarea class="inp" style="width:100%; min-height:90px; resize:vertical;" data-mem-kw="' + UI.activeIndex + '">' + esc(active.keywords || '') + '</textarea>';
        html += '    <div class="eng-muted" style="margin-top:6px;">Example: <b>strawberry, cake</b> or one per line. Whole-word prevents partial matches.</div>';
        html += '  </div>';
      }

      html += '<div style="margin-top:12px;">' + renderSectionToggle('Write', 'write', sec.write) + '</div>';
      if (sec.write) {
        html += '  <div class="card" style="padding:12px; margin-top:10px;">';
        html += '    <label class="eng-lab">Memory Text (what gets saved)</label>';
        html += '    <textarea class="inp" style="width:100%; min-height:120px; resize:vertical;" data-mem-text="' + UI.activeIndex + '">' + esc(active.memoryText || '') + '</textarea>';
        html += '    <div class="eng-muted" style="margin-top:6px;">Tip: write it as a stable fact (e.g., “{{user}} likes strawberry cake.”). Basic mode saves it once by default.</div>';
        html += '  </div>';
      }

      html += '<div style="margin-top:12px;">' + renderSectionToggle('Notes', 'notes', sec.notes) + '</div>';
      if (sec.notes) {
        html += '  <div class="card" style="padding:12px; margin-top:10px;">';
        html += '    <label class="eng-lab">Notes (not exported)</label>';
        html += '    <textarea class="inp" style="width:100%; min-height:80px; resize:vertical;" data-mem-notes="' + UI.activeIndex + '">' + esc(active.notes || '') + '</textarea>';
        html += '  </div>';
      }
    }

    html += '    </div>'; // editor
    html += '  </div>'; // lb-body

    // Bottom full-span preview
    html += '  <div class="eng-block" style="margin-top:14px; width:100%;">';
    html += '    <div class="lb-editor-head" style="margin-bottom:8px;">';
    html += '      <div class="eng-h" style="margin:0;">Generated Script (Memory module)</div>';
    html += '      <div class="lb-editor-actions">';
    html += '        <button class="btn btn-ghost lb-mini" type="button" id="mem-copy">Copy</button>';
    html += '      </div>';
    html += '    </div>';
    html += '    <div class="eng-muted" style="font-size:12px; margin-bottom:8px;">Paste-ready ES5 snippet. Writes to <code>context.character.personality</code> / <code>context.character.scenario</code>.</div>';
    html += '    <textarea class="inp" id="mem-preview" readonly spellcheck="false" style="width:100%; min-height:320px; resize:vertical; box-sizing:border-box; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></textarea>';
    html += '  </div>';

    // Checks block
    html += '  <div class="eng-block" style="margin-top:14px;">';
    html += '    <div class="eng-h">Memory Checks</div>';
    html += '    <div class="eng-muted">Warnings help you spot overlaps and empty items. Engine handles cross-module write conflicts.</div>';
    html += '    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px;">';

    html += '      <div class="card" style="padding:12px;">';
    html += '        <div class="meta-label" style="margin-bottom:8px;">Errors</div>';
    if (!diag.errors.length) html += '        <div class="eng-muted">(none)</div>';
    else {
      html += '        <ul class="eng-ul">';
      for (var ei = 0; ei < diag.errors.length; ei++) html += '          <li>' + esc(diag.errors[ei]) + '</li>';
      html += '        </ul>';
    }
    html += '      </div>';

    html += '      <div class="card" style="padding:12px;">';
    html += '        <div class="meta-label" style="margin-bottom:8px;">Warnings</div>';
    if (!diag.warnings.length) html += '        <div class="eng-muted">(none)</div>';
    else {
      html += '        <ul class="eng-ul">';
      for (var wi = 0; wi < diag.warnings.length; wi++) html += '          <li>' + esc(diag.warnings[wi]) + '</li>';
      html += '        </ul>';
    }
    html += '      </div>';

    html += '    </div>';
    html += '  </div>';

    html += '</div>'; // lb-shell

    rootEl.innerHTML = html;

    function updatePreview() {
      var prev = $('mem-preview');
      if (!prev) return;
      var code = generateScript(cfg);
      if (!code) {
        prev.value = '/* Memory module is either disabled or has no enabled entries. */';
        return;
      }
      prev.value = code;
    }

    // Top toggles
    var enb = $('mem-enabled');
    if (enb) enb.onchange = function () {
      cfg.enabled = !!enb.checked;
      saveState(S);
      updatePreview();
      render(rootEl, S);
    };

    var cse = $('mem-case');
    if (cse) cse.onchange = function () {
      cfg.defaults.caseSensitive = !!cse.checked;
      saveState(S);
      updatePreview();
    };

    var ww = $('mem-word');
    if (ww) ww.onchange = function () {
      cfg.defaults.wholeWord = !!ww.checked;
      saveState(S);
      updatePreview();
    };

    var ot = $('mem-onetime');
    if (ot) ot.onchange = function () {
      cfg.defaults.oneTime = !!ot.checked;
      saveState(S);
      updatePreview();
    };

    var dt = $('mem-defaultTarget');
    if (dt) dt.onchange = function () {
      cfg.defaults.defaultTarget = (dt.value === 'scenario') ? 'scenario' : 'personality';
      saveState(S);
    };

    var add = $('mem-add');
    if (add) add.onclick = function () {
      cfg.entries.push(newEntry(cfg.defaults.defaultTarget));
      setActive(S, cfg.entries.length - 1);
      saveState(S);
      render(rootEl, S);
    };

    var addEmpty = $('mem-add-empty');
    if (addEmpty) addEmpty.onclick = function () {
      if (add) add.click();
    };

    var copyBtn = $('mem-copy');
    if (copyBtn) copyBtn.onclick = function () {
      var ta = $('mem-preview');
      if (!ta) return;
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (_e) { }
    };

    // Click delegation
    rootEl.onclick = function (ev) {
      ev = ev || window.event;
      var t = ev.target || ev.srcElement;

      var tabNode = findAttrNode(t, rootEl, 'data-mem-tab');
      if (tabNode) {
        var idx = parseInt(tabNode.getAttribute('data-mem-tab'), 10);
        if (!isNaN(idx)) { setActive(S, idx); render(rootEl, S); }
        return;
      }

      var secNode = findAttrNode(t, rootEl, 'data-mem-sec');
      if (secNode) {
        var p = String(secNode.getAttribute('data-mem-sec')).split(':');
        var vi = parseInt(p[0], 10);
        var key = p[1];
        if (!isNaN(vi) && key) {
          var st = getSectionState(vi);
          st[key] = !st[key];
          render(rootEl, S);
        }
        return;
      }

      var delNode = findAttrNode(t, rootEl, 'data-mem-del');
      if (delNode) {
        var di = parseInt(delNode.getAttribute('data-mem-del'), 10);
        if (!isNaN(di)) {
          cfg.entries.splice(di, 1);
          if (cfg.activeIndex >= cfg.entries.length) cfg.activeIndex = cfg.entries.length ? (cfg.entries.length - 1) : 0;
          saveState(S);
          render(rootEl, S);
        }
        return;
      }

      var dupNode = findAttrNode(t, rootEl, 'data-mem-dup');
      if (dupNode) {
        var si = parseInt(dupNode.getAttribute('data-mem-dup'), 10);
        if (!isNaN(si) && cfg.entries[si]) {
          var src = cfg.entries[si];
          var copy = {
            id: makeId(),
            enabled: src.enabled,
            title: (src.title ? (String(src.title) + ' (copy)') : ''),
            target: (src.target === 'scenario') ? 'scenario' : 'personality',
            keywords: String(src.keywords || ''),
            memoryText: String(src.memoryText || ''),
            notes: String(src.notes || '')
          };
          cfg.entries.splice(si + 1, 0, copy);
          cfg.activeIndex = si + 1;
          saveState(S);
          render(rootEl, S);
        }
      }
    };

    // Change delegation
    rootEl.onchange = function (ev) {
      ev = ev || window.event;
      var t = ev.target || ev.srcElement;
      if (!t || !t.getAttribute) return;

      function eAt(i) { return cfg.entries[i]; }

      var en = t.getAttribute('data-mem-en');
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

      var title = t.getAttribute('data-mem-title');
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

      var target = t.getAttribute('data-mem-target');
      if (target != null) {
        i = parseInt(target, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).target = (t.value === 'scenario') ? 'scenario' : 'personality';
          saveState(S);
          updatePreview();
          render(rootEl, S);
        }
        return;
      }

      var kw = t.getAttribute('data-mem-kw');
      if (kw != null) {
        i = parseInt(kw, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).keywords = t.value;
          saveState(S);
          updatePreview();
          render(rootEl, S);
        }
        return;
      }

      var txt = t.getAttribute('data-mem-text');
      if (txt != null) {
        i = parseInt(txt, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).memoryText = t.value;
          saveState(S);
          updatePreview();
        }
        return;
      }

      var notes = t.getAttribute('data-mem-notes');
      if (notes != null) {
        i = parseInt(notes, 10);
        if (!isNaN(i) && eAt(i)) {
          eAt(i).notes = t.value;
          saveState(S);
        }
      }
    };

    updatePreview();
  }

  /* ========================= PANEL REGISTRATION ========================= */

  root.Panels.register({
    id: 'memory',

    mount: function (rootEl, S) {
      ensureState(S);
      loadState(S);
      render(rootEl, S);
    },

    getExportBlocks: function (S) {
      ensureState(S);
      var cfg = S.data.memory;
      return [{
        kind: 'script',
        id: 'memory.basic',
        code: generateScript(cfg)
      }];
    },

    getWriteTargets: function (S) {
      ensureState(S);
      var cfg = S.data.memory;
      if (!cfg.enabled) return [];

      var hasScenario = false;
      var hasPersonality = false;

      for (var i = 0; i < cfg.entries.length; i++) {
        var e = cfg.entries[i];
        if (!e || !e.enabled) continue;
        if ((e.target || 'personality') === 'scenario') hasScenario = true;
        else hasPersonality = true;
      }

      var out = [];
      if (hasPersonality) out.push('context.character.personality');
      if (hasScenario) out.push('context.character.scenario');
      return out;
    },

    getRuleSpecs: function (S) {
      ensureState(S);
      var cfg = S.data.memory;
      if (!cfg.enabled) return [];

      var specs = [];
      var entries = cfg.entries || [];

      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e) continue;

        specs.push({
          id: 'memory:' + (e.id || ('m' + i)),
          moduleId: 'memory',
          enabled: !!e.enabled,
          label: entryTitle(e, i),

          match: {
            type: 'keyword',
            keywordsRaw: String(e.keywords || ''),
            caseSensitive: !!cfg.defaults.caseSensitive,
            wholeWord: !!cfg.defaults.wholeWord
          },

          write: {
            target: (e.target === 'scenario') ? 'context.character.scenario' : 'context.character.personality',
            marker: '[MEM:' + (e.id || ('m' + i)) + ']',
            text: String(e.memoryText || '')
          }
        });
      }

      return specs;
    }
  });

})(window);

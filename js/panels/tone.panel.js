/* tone.panel.js — Basic Tone panel (ES5)
 * - Lorebook-like layout using global panels.css (lb-*) — NO per-panel CSS injection
 * - AUTO-SAVE (no Save button); Clear remains (confirm) for convenience
 * - getRuleSpecs() outputs canonical SourceId-based specs
 * - getExportBlocks() outputs paste-ready ES5 snippet (context.character.*)
 */
(function (root) {
  'use strict';

  var PANEL_ID = 'tone';
  var STORE_KEY = 'studio.data.tone';

  // ---------------------------
  // Helpers (ES5)
  // ---------------------------
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return (el || document).querySelectorAll(sel); }
  function escHtml(s) {
    s = (s == null ? '' : String(s));
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uid() {
    return 't' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
  function clone(x) { try { return JSON.parse(JSON.stringify(x || {})); } catch (_e) { return {}; } }
  function lsGet(k, fb) { try { var v = localStorage.getItem(k); return v == null ? fb : v; } catch (_e) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_e) { } }

  function parseKeywords(raw) {
    raw = raw == null ? '' : String(raw);
    var parts = raw.split(/[,;\n\r]+/);
    var out = [], i, s;
    for (i = 0; i < parts.length; i++) {
      s = parts[i];
      if (!s) continue;
      s = s.replace(/^\s+|\s+$/g, '');
      if (!s) continue;
      out.push(s);
    }
    return out;
  }

  function firstKeyword(raw) {
    var k = parseKeywords(raw);
    return k.length ? k[0] : '(no keywords)';
  }

  // Resolve a write target (sourceId preferred) -> context path
  function resolveWritePath(targetIdOrPath) {
    if (!targetIdOrPath) return 'context.character.personality';
    var s = String(targetIdOrPath);
    if (s.indexOf('context.') === 0) return s; // legacy direct path

    if (root.Sources && typeof root.Sources.getSpec === 'function') {
      var spec = root.Sources.getSpec(s);
      if (spec && spec.pathHint) return spec.pathHint;
    }
    if (s === 'character.personality') return 'context.character.personality';
    if (s === 'character.scenario') return 'context.character.scenario';
    return s;
  }

  function nonEmpty(s) {
    return !!(s && String(s).replace(/\s+/g, '').length);
  }

  function clampInt(n, lo, hi) {
    n = parseInt(n, 10);
    if (isNaN(n)) n = lo;
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  // ---------------------------
  // State
  // ---------------------------
  function ensureStudioState() {
    root.StudioState = root.StudioState || {};
    root.StudioState.data = root.StudioState.data || {};
    if (!root.StudioState.data[PANEL_ID]) {
      root.StudioState.data[PANEL_ID] = defaultData();
    }
    return root.StudioState;
  }

  function defaultData() {
    return {
      version: 2,
      entries: [],
      ui: { activeId: null }
    };
  }

  function loadData() {
    var st = ensureStudioState();
    var raw = lsGet(STORE_KEY, '');
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          st.data[PANEL_ID] = parsed;
        }
      } catch (_e) { }
    }
    var d = st.data[PANEL_ID] || defaultData();
    d.entries = d.entries && d.entries.length ? d.entries : [];
    d.ui = d.ui || { activeId: null };
    st.data[PANEL_ID] = d;

    // normalize entries lightly
    for (var i = 0; i < d.entries.length; i++) {
      var e = d.entries[i];
      if (!e) continue;
      if (!e.id) e.id = uid();
      if (typeof e.enabled !== 'boolean') e.enabled = true;
      if (e.keywordsRaw == null) e.keywordsRaw = '';
      if (e.text == null) e.text = '';
      if (!e.targetId) e.targetId = 'character.personality';
      if (e.targetId !== 'character.personality' && e.targetId !== 'character.scenario') {
        e.targetId = 'character.personality';
      }
      if (typeof e.wholeWord !== 'boolean') e.wholeWord = true;
      if (typeof e.allowSuffixes !== 'boolean') e.allowSuffixes = true;
      if (typeof e.negationGuard !== 'boolean') e.negationGuard = false;
      if (e.negationWindow == null) e.negationWindow = 4;
      e.negationWindow = clampInt(e.negationWindow, 1, 12);
    }

    return d;
  }

  function saveData() {
    var st = ensureStudioState();
    var d = st.data[PANEL_ID] || defaultData();
    lsSet(STORE_KEY, JSON.stringify(d));
  }

  function getEntryById(data, id) {
    for (var i = 0; i < data.entries.length; i++) {
      if (data.entries[i] && data.entries[i].id === id) return data.entries[i];
    }
    return null;
  }

  function ensureActive(data) {
    if (data.ui && data.ui.activeId && getEntryById(data, data.ui.activeId)) return;
    data.ui.activeId = (data.entries[0] && data.entries[0].id) ? data.entries[0].id : null;
  }

  // ---------------------------
  // UI helpers (patch list row without full rerender)
  // ---------------------------
  function patchListRow(rootEl, entryId, entry) {
    var host = $('#tone-list', rootEl);
    if (!host) return;
    var btn = host.querySelector('[data-id="' + entryId + '"]');
    if (!btn) return;

    var nameEl = btn.querySelector('.lb-tab-name');
    if (nameEl) nameEl.textContent = firstKeyword(entry.keywordsRaw);

    // chips/meta
    var meta = btn.querySelector('.lb-tab-meta');
    if (meta) {
      var tgt = (entry.targetId === 'character.scenario') ? '→ Scenario' : '→ Personality';
      var preview = (entry.text ? String(entry.text).slice(0, 60) : '');
      meta.innerHTML =
        '<span class="lb-chip">' + escHtml(tgt) + '</span>' +
        (preview ? '<span class="lb-meta">' + escHtml(preview) + '</span>' : '<span class="lb-meta">(empty)</span>');
    }

    var dot = btn.querySelector('.lb-dot');
    if (dot) {
      dot.className = 'lb-dot ' + ((entry.enabled !== false) ? 'on' : 'off');
    }
  }

  // ---------------------------
  // UI (Lorebook-like layout)
  // ---------------------------
  function buildShell(el) {
    el.innerHTML =
      '<div class="lb-shell">' +
      '<div class="lb-body">' +

      '<div class="lb-tabs eng-block">' +
      '<div class="eng-h">Tone Rules</div>' +
      '<div class="lb-tablist" id="tone-list"></div>' +
      '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn" id="tone-add" type="button">Add</button>' +
      '<button class="btn btn-ghost" id="tone-dup" type="button">Duplicate</button>' +
      '<button class="btn btn-danger" id="tone-del" type="button">Delete</button>' +
      '</div>' +
      '</div>' +

      '<div class="lb-editor eng-block" id="tone-editor"></div>' +

      '</div>' +

      // Full-span preview (bottom)
      '<div class="eng-block" id="tone-preview-wrap" style="margin-top:14px; width:100%;">' +
      '<div class="lb-editor-head" style="margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">' +
      '<div class="eng-h" style="margin:0;">Generated Script (Tone module)</div>' +
      '<div class="lb-editor-actions" style="display:flex; gap:8px; align-items:center;">' +
      '<button class="btn btn-ghost lb-mini" type="button" id="tone-copy">Copy</button>' +
      '</div>' +
      '</div>' +
      '<div class="eng-muted" style="font-size:12px; margin-bottom:8px;">' +
      'Paste-ready ES5 snippet. Writes to <code>context.character.personality</code> / <code>context.character.scenario</code>.' +
      '</div>' +
      '<textarea id="tone-preview" readonly spellcheck="false" ' +
      'style="width:100%; min-height:320px; resize:vertical; box-sizing:border-box; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></textarea>' +
      '</div>' +

      '</div>';
  }

  function renderList(rootEl, data) {
    var host = $('#tone-list', rootEl);
    if (!host) return;

    if (!data.entries.length) {
      host.innerHTML = '<div class="eng-muted" style="margin-bottom:12px;">(no rules yet)</div>';
      return;
    }

    var html = '';
    var active = data.ui.activeId;

    for (var i = 0; i < data.entries.length; i++) {
      var e = data.entries[i];
      if (!e) continue;

      var on = (e.enabled !== false);
      var title = firstKeyword(e.keywordsRaw);
      var target = (e.targetId === 'character.scenario') ? '→ Scenario' : '→ Personality';
      var preview = (e.text ? String(e.text).slice(0, 60) : '');

      html += '' +
        '<button class="lb-tab' + (e.id === active ? ' is-active' : '') + '" type="button" data-id="' + escHtml(e.id) + '">' +
        '<div class="lb-tab-top">' +
        '<span class="lb-dot ' + (on ? 'on' : 'off') + '" aria-hidden="true" title="' + (on ? 'Enabled' : 'Disabled') + '"></span>' +
        '<span class="lb-tab-name">' + escHtml(title) + '</span>' +
        '</div>' +
        '<div class="lb-tab-meta">' +
        '<span class="lb-chip">' + escHtml(target) + '</span>' +
        (preview ? '<span class="lb-meta">' + escHtml(preview) + '</span>' : '<span class="lb-meta">(empty)</span>') +
        '</div>' +
        '</button>';
    }

    host.innerHTML = html;

    var rows = $all('.lb-tab', host);
    for (var r = 0; r < rows.length; r++) {
      rows[r].onclick = function () {
        data.ui.activeId = this.getAttribute('data-id');
        saveData();
        renderAll(rootEl, data);
      };
    }
  }

  function checkboxRow(id, label, checked) {
    return '' +
      '<label class="pill pill-ok" style="cursor:pointer;">' +
      '<input id="' + id + '" type="checkbox" ' + (checked ? 'checked' : '') + '> ' +
      '<span>' + escHtml(label) + '</span>' +
      '</label>';
  }

  function renderEditor(rootEl, data) {
    var host = $('#tone-editor', rootEl);
    if (!host) return;

    ensureActive(data);
    var e = data.ui.activeId ? getEntryById(data, data.ui.activeId) : null;
    if (!e) {
      host.innerHTML = '<div class="eng-muted" style="margin-bottom:12px;">Select or add a tone rule.</div>';
      return;
    }

    var on = (e.enabled !== false);
    var title = firstKeyword(e.keywordsRaw);

    var target = e.targetId || 'character.personality';
    var negOn = !!e.negationGuard;
    var negWin = (e.negationWindow == null ? 4 : (e.negationWindow | 0));
    negWin = clampInt(negWin, 1, 12);

    host.innerHTML =
      '<div class="lb-editor-head">' +
      '<div class="eng-h" style="margin:0;">Tone — ' + escHtml(title) + '</div>' +
      '<div class="lb-editor-actions">' +
      '<label class="pill pill-ok" style="cursor:pointer;">' +
      '<input id="tone-enabled" type="checkbox" ' + (on ? 'checked' : '') + ' /> Enabled' +
      '</label>' +
      '<button class="btn btn-ghost lb-mini" id="tone-clear" type="button">Clear</button>' +
      '</div>' +
      '</div>' +

      '<div style="margin-top:12px;">' +
      '<div class="card" style="padding:12px;">' +

      '<div class="row" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">' +
      '<label class="ctl">Write target ' +
      '<select id="tone-target">' +
      '<option value="character.personality" ' + (target === 'character.personality' ? 'selected' : '') + '>Personality</option>' +
      '<option value="character.scenario" ' + (target === 'character.scenario' ? 'selected' : '') + '>Scenario</option>' +
      '</select>' +
      '</label>' +
      '</div>' +

      '<div style="margin-top:10px;">' +
      '<label style="display:block; font-weight:600;">Keywords</label>' +
      '<textarea id="tone-keywords" style="width:100%; min-height:70px; resize:vertical;" placeholder="rain, raining">' + escHtml(e.keywordsRaw || '') + '</textarea>' +
      '<div class="eng-muted" style="font-size:12px; margin-top:4px;">Comma or newline separated. Whole-word matching avoids “training” matching “rain”.</div>' +
      '</div>' +

      '<div style="margin-top:10px;">' +
      '<label style="display:block; font-weight:600;">Tone line to inject</label>' +
      '<textarea id="tone-text" style="width:100%; min-height:90px; resize:vertical;" placeholder="{Char} is always sad when it rains.">' + escHtml(e.text || '') + '</textarea>' +
      '</div>' +

      '<div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">' +
      checkboxRow('tone-wholeword', 'Whole word', e.wholeWord !== false) +
      checkboxRow('tone-suffix', 'Allow “-ing” suffix', e.allowSuffixes !== false) +
      checkboxRow('tone-neg', 'Negation guard (not/no/never…)', negOn) +
      '<label class="ctl">Negation window ' +
      '<input id="tone-negwin" type="number" min="1" max="12" step="1" value="' + escHtml(negWin) + '" style="width:90px;">' +
      '</label>' +
      '</div>' +

      '<div class="eng-muted" style="font-size:12px; margin-top:10px;">Auto-save is on. Changes are saved immediately.</div>' +

      '</div>' +
      '</div>';

    // ---- Auto-save wiring (keep editor stable; patch list + preview) ----
    function commit() {
      saveData();
      patchListRow(rootEl, e.id, e);
      updatePreview(rootEl);
    }

    $('#tone-enabled', host).onchange = function () {
      e.enabled = !!this.checked;
      commit();
    };

    $('#tone-target', host).onchange = function () {
      var v = this.value || 'character.personality';
      if (v !== 'character.personality' && v !== 'character.scenario') v = 'character.personality';
      e.targetId = v;
      commit();
    };

    $('#tone-keywords', host).oninput = function () {
      e.keywordsRaw = this.value || '';
      // title depends on keywords → patch list + editor header needs refresh
      saveData();
      renderAll(rootEl, data); // lightweight enough, and keeps header accurate
    };

    $('#tone-text', host).oninput = function () {
      e.text = this.value || '';
      commit();
    };

    $('#tone-wholeword', host).onchange = function () {
      e.wholeWord = !!this.checked;
      commit();
    };

    $('#tone-suffix', host).onchange = function () {
      e.allowSuffixes = !!this.checked;
      commit();
    };

    $('#tone-neg', host).onchange = function () {
      e.negationGuard = !!this.checked;
      commit();
    };

    $('#tone-negwin', host).oninput = function () {
      e.negationWindow = clampInt(this.value, 1, 12);
      commit();
    };

    // Clear (kept as explicit action)
    var btnClear = $('#tone-clear', host);
    if (btnClear) btnClear.onclick = function () {
      if (!confirm('Clear this tone rule’s fields?')) return;
      e.keywordsRaw = '';
      e.text = '';
      e.wholeWord = true;
      e.allowSuffixes = true;
      e.negationGuard = false;
      e.negationWindow = 4;
      e.targetId = 'character.personality';
      saveData();
      renderAll(rootEl, data);
    };
  }

  function renderAll(rootEl, data) {
    renderList(rootEl, data);
    renderEditor(rootEl, data);
    updatePreview(rootEl);
  }

  function addEntry(data) {
    var id = uid();
    data.entries.unshift({
      id: id,
      enabled: true,
      keywordsRaw: '',
      text: '',
      targetId: 'character.personality',
      wholeWord: true,
      allowSuffixes: true,
      negationGuard: false,
      negationWindow: 4
    });
    data.ui.activeId = id;
    saveData();
  }

  function dupEntry(data) {
    ensureActive(data);
    var src = data.ui.activeId ? getEntryById(data, data.ui.activeId) : null;
    if (!src) return;
    var c = clone(src);
    c.id = uid();
    data.entries.unshift(c);
    data.ui.activeId = c.id;
    saveData();
  }

  function delEntry(data) {
    ensureActive(data);
    var id = data.ui.activeId;
    if (!id) return;
    var idx = -1;
    for (var i = 0; i < data.entries.length; i++) {
      if (data.entries[i] && data.entries[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    if (!confirm('Delete this tone rule?')) return;
    data.entries.splice(idx, 1);
    data.ui.activeId = (data.entries[0] && data.entries[0].id) ? data.entries[0].id : null;
    saveData();
  }

  // ---------------------------
  // DSL hooks
  // ---------------------------
  function getRuleSpecs(studioState) {
    studioState = studioState || ensureStudioState();
    var data = (studioState.data && studioState.data[PANEL_ID]) ? studioState.data[PANEL_ID] : defaultData();
    var out = [];

    for (var i = 0; i < data.entries.length; i++) {
      var e = data.entries[i];
      if (!e || e.enabled === false) continue;

      var kws = parseKeywords(e.keywordsRaw);
      if (!kws.length) continue;
      if (!nonEmpty(e.text)) continue;

      out.push({
        id: 'tone:' + e.id,
        moduleId: PANEL_ID,
        enabled: true,
        label: 'Tone: ' + firstKeyword(e.keywordsRaw),

        when: {
          sourceId: 'lastUser.norm',
          match: {
            type: 'keyword',
            keywords: kws,
            wholeWord: (e.wholeWord !== false),
            allowSuffixes: (e.allowSuffixes !== false),
            caseSensitive: false,
            negationGuard: { on: !!e.negationGuard, window: (e.negationWindow == null ? 4 : (e.negationWindow | 0)) }
          }
        },

        write: {
          targetId: (e.targetId || 'character.personality'),
          marker: '[TONE:' + e.id + ']',
          text: String(e.text || '')
        }
      });
    }
    return out;
  }

  function getWriteTargets(studioState) {
    studioState = studioState || ensureStudioState();
    var data = (studioState.data && studioState.data[PANEL_ID]) ? studioState.data[PANEL_ID] : defaultData();
    var map = {}, out = [];

    for (var i = 0; i < data.entries.length; i++) {
      var e = data.entries[i];
      if (!e || e.enabled === false) continue;
      var t = resolveWritePath(e.targetId || 'character.personality');
      map[t] = true;
    }
    for (var k in map) if (hasOwn(map, k)) out.push(k);
    out.sort();
    return out;
  }

  function getExportBlocks(studioState) {
    var rules = getRuleSpecs(studioState);
    var code = emitES5FromToneRuleSpecs(rules);
    return [{ kind: 'script', id: 'tone.basic', code: code }];
  }

  function emitES5FromToneRuleSpecs(rules) {
    if (!rules || !rules.length) return '';
    var packed = [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r || r.enabled === false) continue;
      var m = (r.when && r.when.match) ? r.when.match : {};
      packed.push({
        id: r.id,
        marker: (r.write && r.write.marker) ? r.write.marker : '',
        target: resolveWritePath((r.write && (r.write.targetId || r.write.target)) || 'character.personality'),
        text: (r.write && r.write.text) ? String(r.write.text) : '',
        keywords: (m.keywords && m.keywords.length) ? m.keywords : [],
        wholeWord: !!m.wholeWord,
        allowSuffixes: !!m.allowSuffixes,
        negOn: !!(m.negationGuard && m.negationGuard.on),
        negWin: (m.negationGuard && m.negationGuard.window != null) ? (m.negationGuard.window | 0) : 4
      });
    }

    var json = JSON.stringify(packed);

    return '' +
      "(function(){\n" +
      "  'use strict';\n" +
      "  function hasNegation(beforeTokens, win){\n" +
      "    var neg = { 'not':1,'no':1,'never':1,'isnt':1,'dont':1,'cant':1,'wont':1,'aint':1 };\n" +
      "    var n = beforeTokens.length;\n" +
      "    var start = n - win; if(start<0) start = 0;\n" +
      "    for(var i=n-1;i>=start;i--){\n" +
      "      var t = beforeTokens[i];\n" +
      "      if(!t) continue;\n" +
      "      if(neg[t]) return true;\n" +
      "    }\n" +
      "    return false;\n" +
      "  }\n" +
      "\n" +
      "  var rules = " + json + ";\n" +
      "  if(!rules || !rules.length) return;\n" +
      "  if(!context || !context.chat) return;\n" +
      "\n" +
      "  var s = SBX_R.norm(context.chat.last_message);\n" +
      "  if(!s) return;\n" +
      "\n" +
      "  for(var ri=0;ri<rules.length;ri++){\n" +
      "    var r = rules[ri];\n" +
      "    if(!r || !r.keywords || !r.keywords.length) continue;\n" +
      "    if(!r.text) continue;\n" +
      "\n" +
      "    var path = String(r.target).replace(/^context\\./,'');\n" +
      "    var cur = String(SBX_R.get(context, path) || '');\n" +
      "    if(r.marker && cur.indexOf(r.marker) !== -1) continue;\n" +
      "\n" +
      "    var matched = false;\n" +
      "    for(var ki=0;ki<r.keywords.length;ki++){\n" +
      "      var kw = SBX_R.norm(r.keywords[ki]);\n" +
      "      if(!kw) continue;\n" +
      "      var pat = SBX_R.escRegex(kw);\n" +
      "      if(r.allowSuffixes && /^[a-z]+$/.test(kw) && kw.length>=3 && kw.indexOf('ing', kw.length-3) === -1){\n" +
      "        pat = pat + '(?:ing)?';\n" +
      "      }\n" +
      "      if(r.wholeWord) pat = '\\\\b' + pat + '\\\\b';\n" +
      "      var re = new RegExp(pat, 'i');\n" +
      "      var m = re.exec(s);\n" +
      "      if(m){\n" +
      "        if(r.negOn){\n" +
      "          var before = s.slice(0, m.index);\n" +
      "          var toks = before.split(' ');\n" +
      "          var win = r.negWin>0 ? r.negWin : 4;\n" +
      "          if(hasNegation(toks, win)) { continue; }\n" +
      "        }\n" +
      "        matched = true;\n" +
      "        break;\n" +
      "      }\n" +
      "    }\n" +
      "\n" +
      "    if(matched) SBX_R.append(context, path, r.text, r.marker, false);\n" +
      "  }\n" +
      "})();\n";
  }

  function updatePreview(rootEl) {
    var ta = $('#tone-preview', rootEl);
    if (!ta) return;
    try {
      var blocks = getExportBlocks(root.StudioState) || [];
      var code = (blocks[0] && blocks[0].code) ? String(blocks[0].code) : '';
      if (!code) {
        ta.value = '/* Tone module has no enabled rules. */';
      } else {
        ta.value = code;
      }
    } catch (_e) {
      ta.value = '';
    }
  }

  // ---------------------------
  // Mount / Register
  // ---------------------------
  function mount(el /*, studioState */) {
    var data = loadData();
    ensureActive(data);
    buildShell(el);
    renderAll(el, data);

    var btnAdd = $('#tone-add', el);
    var btnDup = $('#tone-dup', el);
    var btnDel = $('#tone-del', el);

    if (btnAdd) btnAdd.onclick = function () { addEntry(data); renderAll(el, data); };
    if (btnDup) btnDup.onclick = function () { dupEntry(data); renderAll(el, data); };
    if (btnDel) btnDel.onclick = function () { delEntry(data); renderAll(el, data); };

    var copyBtn = $('#tone-copy', el);
    if (copyBtn) copyBtn.onclick = function () {
      var ta = $('#tone-preview', el);
      if (!ta) return;
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (_e) { }
    };
  }

  var def = {
    id: PANEL_ID,
    mount: mount,
    getRuleSpecs: getRuleSpecs,
    getWriteTargets: getWriteTargets,
    getExportBlocks: getExportBlocks
  };

  if (root.Panels && typeof root.Panels.register === 'function') {
    root.Panels.register(def);
  } else {
    root.Panels = root.Panels || { register: function (d) { root.Panels[d.id] = d; } };
    root.Panels.register(def);
  }

})(window);

/* events.panel.js — Basic Events/Pacing panel (Lorebook-like list/buttons), DSL-first (ES5)
 * Changes:
 * - Auto-save on all edits (removed Save button)
 * - Added full-width code viewer + Copy button (like other pages)
 */
(function (root) {
  'use strict';

  var PANEL_ID = 'events';
  var STORE_KEY = 'studio.data.events';

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return (el || document).querySelectorAll(sel); }
  function escHtml(s) {
    s = (s == null ? '' : String(s));
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uid() { return 'e' + Math.random().toString(16).slice(2) + Date.now().toString(16); }
  function clone(x) { try { return JSON.parse(JSON.stringify(x || {})); } catch (_e) { return {}; } }
  function lsGet(k, fb) { try { var v = localStorage.getItem(k); return v == null ? fb : v; } catch (_e) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_e) { } }

  function toInt(v, d) { v = parseInt(v, 10); return isNaN(v) ? d : v; }
  function clampInt(n, lo, hi) {
    n = toInt(n, lo);
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }
  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
  function nonEmpty(s) { return !!(s && String(s).replace(/\s+/g, '').length); }

  function resolveWritePath(targetIdOrPath) {
    if (!targetIdOrPath) return 'context.character.personality';
    var s = String(targetIdOrPath);
    if (s.indexOf('context.') === 0) return s;
    if (root.Sources && typeof root.Sources.getSpec === 'function') {
      var spec = root.Sources.getSpec(s);
      if (spec && spec.pathHint) return spec.pathHint;
    }
    if (s === 'character.personality') return 'context.character.personality';
    if (s === 'character.scenario') return 'context.character.scenario';
    return s;
  }

  function ensureStudioState() {
    root.StudioState = root.StudioState || {};
    root.StudioState.data = root.StudioState.data || {};
    if (!root.StudioState.data[PANEL_ID]) root.StudioState.data[PANEL_ID] = defaultData();
    return root.StudioState;
  }

  function defaultData() {
    return {
      version: 3,
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
        if (parsed && typeof parsed === 'object') st.data[PANEL_ID] = parsed;
      } catch (_e) { }
    }

    var d = st.data[PANEL_ID] || defaultData();
    d.entries = (d.entries && d.entries.length) ? d.entries : [];
    d.ui = d.ui || { activeId: null };

    for (var i = 0; i < d.entries.length; i++) {
      var e = d.entries[i];
      if (!e) continue;

      // Legacy migration: single text -> personality
      if (e.text != null && e.textPersonality == null && e.textScenario == null) {
        e.textPersonality = String(e.text || '');
        e.textScenario = '';
        delete e.text;
      }

      if (!e.id) e.id = uid();
      if (e.name == null) e.name = '';
      if (typeof e.once !== 'boolean') e.once = true;
      if (typeof e.enabled !== 'boolean') e.enabled = true;

      if (typeof e.minCount !== 'number') e.minCount = toInt(e.minCount, 0);
      if (typeof e.maxCount !== 'number') e.maxCount = toInt(e.maxCount, e.minCount);

      if (e.textPersonality == null) e.textPersonality = '';
      if (e.textScenario == null) e.textScenario = '';
    }

    st.data[PANEL_ID] = d;
    return d;
  }

  function saveData() {
    var st = ensureStudioState();
    lsSet(STORE_KEY, JSON.stringify(st.data[PANEL_ID] || defaultData()));
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

  function entryTitle(e) {
    if (!e) return 'Event';
    var nm = trim(e.name || '');
    var minC = (e.minCount | 0), maxC = (e.maxCount | 0);
    if (maxC < minC) maxC = minC;
    if (nm) return nm;
    return 'Msgs ' + minC + '–' + maxC;
  }

  // ---------------------------
  // UI
  // ---------------------------
  function buildShell(el) {
    el.innerHTML =
      '<div class="lb-shell">' +
      '<div class="lb-body">' +

      '<div class="lb-tabs eng-block">' +
      '<div class="eng-h">Events (Pacing)</div>' +
      '<div class="lb-tablist" id="ev-list"></div>' +
      '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn" id="ev-add" type="button">Add</button>' +
      '<button class="btn btn-ghost" id="ev-dup" type="button">Duplicate</button>' +
      '<button class="btn btn-danger" id="ev-del" type="button">Delete</button>' +
      '</div>' +
      '</div>' +

      '<div class="lb-editor eng-block" id="ev-editor"></div>' +

      '</div>' +

      // Full-width code viewer (like Random)
      '<div class="eng-block" id="ev-preview-wrap" style="margin-top:14px; width:100%;">' +
      '<div class="lb-editor-head" style="margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">' +
      '<div class="eng-h" style="margin:0;">Generated Script (Events module)</div>' +
      '<div class="lb-editor-actions" style="display:flex; gap:8px; align-items:center;">' +
      '<button class="btn btn-ghost lb-mini" type="button" id="ev-copy">Copy</button>' +
      '</div>' +
      '</div>' +
      '<div class="eng-muted" style="font-size:12px; margin-bottom:8px;">Paste-ready ES5 snippet. Writes to <code>context.character.personality</code> / <code>context.character.scenario</code>.</div>' +
      '<textarea id="ev-preview" readonly spellcheck="false" ' +
      'style="width:100%; min-height:320px; resize:vertical; box-sizing:border-box; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></textarea>' +
      '</div>' +

      '</div>';
  }

  function renderList(rootEl, data) {
    var host = $('#ev-list', rootEl);
    if (!host) return;

    if (!data.entries.length) {
      host.innerHTML = '<div class="eng-muted" style="margin-bottom:12px;">(no events yet)</div>' +
        '<button class="btn btn-primary" type="button" id="ev-add-empty">+ Add Your First Event</button>';
      var btnAddEmpty = $('#ev-add-empty', host);
      if (btnAddEmpty) btnAddEmpty.onclick = function () {
        var btnAddOriginal = $('#ev-add', rootEl);
        if (btnAddOriginal) btnAddOriginal.click();
      };
      return;
    }

    var html = '', i, e, active = data.ui.activeId;
    for (i = 0; i < data.entries.length; i++) {
      e = data.entries[i];
      if (!e) continue;

      var on = (e.enabled !== false);
      var minC = (e.minCount | 0), maxC = (e.maxCount | 0);
      if (maxC < minC) maxC = minC;

      var hasP = nonEmpty(e.textPersonality);
      var hasS = nonEmpty(e.textScenario);

      var chips = '';
      if (hasP) chips += '<span class="lb-chip">→ Personality</span>';
      if (hasS) chips += '<span class="lb-chip">→ Scenario</span>';
      if (!chips) chips = '<span class="lb-chip">(no output)</span>';

      var title = entryTitle(e);

      html += '' +
        '<button class="lb-tab' + (e.id === active ? ' is-active' : '') + '" type="button" data-id="' + escHtml(e.id) + '">' +
        '<div class="lb-tab-top">' +
        '<span class="lb-dot ' + (on ? 'on' : 'off') + '" aria-hidden="true" title="' + (on ? 'Enabled' : 'Disabled') + '"></span>' +
        '<span class="lb-tab-name">' + escHtml(title) + '</span>' +
        '</div>' +
        '<div class="lb-tab-meta">' +
        chips +
        '<span class="lb-meta">' + escHtml((e.once !== false) ? ('Msgs ' + minC + '–' + maxC + ' · once') : ('Msgs ' + minC + '–' + maxC + ' · repeat')) + '</span>' +
        '</div>' +
        '</button>';
    }

    host.innerHTML = html;

    var rows = $all('.lb-tab', host);
    for (i = 0; i < rows.length; i++) {
      rows[i].onclick = function () {
        data.ui.activeId = this.getAttribute('data-id');
        saveData();
        renderEditor(rootEl, data);
        updatePreview(rootEl);
        renderList(rootEl, data);
      };
    }
  }

  function setHeaderTitle(host, title) {
    var el = $('#ev-title', host);
    if (el) el.textContent = 'Event — ' + (title || 'Event');
  }

  function renderEditor(rootEl, data) {
    var host = $('#ev-editor', rootEl);
    if (!host) return;

    ensureActive(data);
    var e = data.ui.activeId ? getEntryById(data, data.ui.activeId) : null;
    if (!e) {
      host.innerHTML = '<div class="eng-muted">Select or add an event.</div>';
      return;
    }

    var on = (e.enabled !== false);
    var once = (e.once !== false);

    var minC = clampInt(e.minCount, 0, 999999);
    var maxC = clampInt(e.maxCount, 0, 999999);
    if (maxC < minC) maxC = minC;

    var title = entryTitle(e);

    host.innerHTML =
      '<div class="lb-editor-head">' +
      '<div class="eng-h" id="ev-title" style="margin:0;">Event — ' + escHtml(title) + '</div>' +
      '<div class="lb-editor-actions">' +
      '<label class="pill pill-ok" style="cursor:pointer;">' +
      '<input id="ev-enabled" type="checkbox" ' + (on ? 'checked' : '') + ' /> Enabled' +
      '</label>' +
      '<label class="pill pill-ok" style="cursor:pointer;">' +
      '<input id="ev-once" type="checkbox" ' + (once ? 'checked' : '') + ' /> Once' +
      '</label>' +
      '</div>' +
      '</div>' +

      '<div style="margin-top:12px;" class="card">' +
      '<div style="padding:12px;">' +

      '<div class="row" style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">' +
      '<label class="ctl">Name ' +
      '<input id="ev-name" type="text" value="' + escHtml(e.name || '') + '" style="min-width:260px;">' +
      '</label>' +
      '<label class="ctl">Min message count ' +
      '<input id="ev-min" type="number" min="0" step="1" value="' + minC + '" style="width:120px;">' +
      '</label>' +
      '<label class="ctl">Max message count ' +
      '<input id="ev-max" type="number" min="0" step="1" value="' + maxC + '" style="width:120px;">' +
      '</label>' +
      '<span class="eng-muted" style="font-size:12px;">Triggers by message count range only.</span>' +
      '</div>' +

      '<div style="margin-top:10px;">' +
      '<label style="display:block; font-weight:600;">Personality text to inject</label>' +
      '<textarea id="ev-text-pers" style="width:100%; min-height:90px; resize:vertical;" placeholder="{Char} ...">' + escHtml(e.textPersonality || '') + '</textarea>' +
      '</div>' +

      '<div style="margin-top:10px;">' +
      '<label style="display:block; font-weight:600;">Scenario text to inject</label>' +
      '<textarea id="ev-text-scen" style="width:100%; min-height:90px; resize:vertical;" placeholder="The scene ...">' + escHtml(e.textScenario || '') + '</textarea>' +
      '</div>' +

      '<div class="eng-muted" style="font-size:12px; margin-top:8px;">Repeat is controlled by <b>Once</b>. (Once inserts a marker to prevent duplicates.)</div>' +

      '<div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn btn-ghost" id="ev-clear" type="button">Clear</button>' +
      '</div>' +

      '</div>' +
      '</div>';

    // --- Autosave wiring ---
    $('#ev-enabled', host).onchange = function () {
      e.enabled = !!this.checked;
      saveData();
      renderList(rootEl, data);
      updatePreview(rootEl);
    };

    $('#ev-once', host).onchange = function () {
      e.once = !!this.checked;
      saveData();
      renderList(rootEl, data);
      updatePreview(rootEl);
    };

    $('#ev-name', host).oninput = function () {
      e.name = this.value || '';
      saveData();
      setHeaderTitle(host, entryTitle(e));
      renderList(rootEl, data);
      updatePreview(rootEl);
    };

    $('#ev-min', host).oninput = function () {
      var mn = toInt(this.value, 0);
      var mx = toInt($('#ev-max', host).value, mn);
      if (mx < mn) mx = mn;
      e.minCount = mn;
      e.maxCount = mx;
      $('#ev-max', host).value = mx; // keep UI consistent
      saveData();
      setHeaderTitle(host, entryTitle(e));
      renderList(rootEl, data);
      updatePreview(rootEl);
    };

    $('#ev-max', host).oninput = function () {
      var mn2 = toInt($('#ev-min', host).value, 0);
      var mx2 = toInt(this.value, mn2);
      if (mx2 < mn2) mx2 = mn2;
      e.minCount = mn2;
      e.maxCount = mx2;
      this.value = mx2;
      saveData();
      setHeaderTitle(host, entryTitle(e));
      renderList(rootEl, data);
      updatePreview(rootEl);
    };

    $('#ev-text-pers', host).oninput = function () {
      e.textPersonality = this.value || '';
      saveData();
      renderList(rootEl, data);
      updatePreview(rootEl);
    };

    $('#ev-text-scen', host).oninput = function () {
      e.textScenario = this.value || '';
      saveData();
      renderList(rootEl, data);
      updatePreview(rootEl);
    };

    // Clear (still useful even with autosave)
    var btnClear = $('#ev-clear', host);
    if (btnClear) btnClear.onclick = function () {
      if (!confirm('Clear this event’s fields?')) return;
      e.minCount = 0;
      e.maxCount = 0;
      e.once = true;
      e.textPersonality = '';
      e.textScenario = '';
      // keep name (UX)
      saveData();
      renderEditor(rootEl, data);
      renderList(rootEl, data);
      updatePreview(rootEl);
    };
  }

  // ---------------------------
  // Toolbar ops
  // ---------------------------
  function addEntry(data) {
    var id = uid();
    data.entries.unshift({
      id: id,
      name: '',
      enabled: true,
      once: true,
      minCount: 0,
      maxCount: 0,
      textPersonality: '',
      textScenario: ''
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
    c.name = (c.name ? (String(c.name) + ' (Copy)') : '');
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
    if (!confirm('Delete this event?')) return;

    data.entries.splice(idx, 1);
    data.ui.activeId = (data.entries[0] && data.entries[0].id) ? data.entries[0].id : null;
    saveData();
  }

  // ---------------------------
  // DSL
  // ---------------------------
  function rulesForEntry(e) {
    var rules = [];
    if (!e || e.enabled === false) return rules;

    var minC = toInt(e.minCount, 0);
    var maxC = toInt(e.maxCount, minC);
    if (maxC < minC) maxC = minC;

    var marker = '[EVT:' + e.id + ']';
    var once = (e.once !== false);

    var nm = trim(e.name || '');
    var labelBase = nm ? ('Events: ' + nm + ' (' + minC + '–' + maxC + ')') : ('Events: ' + minC + '–' + maxC);

    var txP = String(e.textPersonality || '');
    var txS = String(e.textScenario || '');

    if (nonEmpty(txP)) {
      rules.push({
        id: 'events:' + e.id + ':character.personality',
        moduleId: PANEL_ID,
        enabled: true,
        label: labelBase,
        when: { sourceId: 'chat.messageCount', match: { type: 'range', min: minC, max: maxC } },
        write: { targetId: 'character.personality', marker: marker, text: txP, once: once }
      });
    }

    if (nonEmpty(txS)) {
      rules.push({
        id: 'events:' + e.id + ':character.scenario',
        moduleId: PANEL_ID,
        enabled: true,
        label: labelBase,
        when: { sourceId: 'chat.messageCount', match: { type: 'range', min: minC, max: maxC } },
        write: { targetId: 'character.scenario', marker: marker, text: txS, once: once }
      });
    }

    return rules;
  }

  function getRuleSpecs(studioState) {
    studioState = studioState || ensureStudioState();
    var data = (studioState.data && studioState.data[PANEL_ID]) ? studioState.data[PANEL_ID] : defaultData();

    var out = [];
    for (var i = 0; i < data.entries.length; i++) {
      var rr = rulesForEntry(data.entries[i]);
      for (var j = 0; j < rr.length; j++) out.push(rr[j]);
    }
    return out;
  }

  function getWriteTargets(studioState) {
    studioState = studioState || ensureStudioState();
    var data = (studioState.data && studioState.data[PANEL_ID]) ? studioState.data[PANEL_ID] : defaultData();

    var map = {}, out = [], i, e;
    for (i = 0; i < data.entries.length; i++) {
      e = data.entries[i];
      if (!e || e.enabled === false) continue;

      if (nonEmpty(e.textPersonality)) map[resolveWritePath('character.personality')] = true;
      if (nonEmpty(e.textScenario)) map[resolveWritePath('character.scenario')] = true;
    }

    for (var k in map) if (hasOwn(map, k)) out.push(k);
    out.sort();
    return out;
  }

  function getExportBlocks(studioState) {
    var rules = getRuleSpecs(studioState);
    var code = emitES5FromEventRuleSpecs(rules);
    return [{ kind: 'script', id: 'events.basic', code: code }];
  }

  function emitES5FromEventRuleSpecs(rules) {
    if (!rules || !rules.length) return '';
    var packed = [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r || r.enabled === false) continue;
      var m = (r.when && r.when.match) ? r.when.match : {};
      packed.push({
        id: r.id,
        min: (m.min == null ? 0 : (m.min | 0)),
        max: (m.max == null ? 0 : (m.max | 0)),
        target: resolveWritePath((r.write && (r.write.targetId || r.write.target)) || 'character.personality'),
        marker: (r.write && r.write.marker) ? r.write.marker : '',
        text: (r.write && r.write.text) ? String(r.write.text) : '',
        once: !!(r.write && r.write.once)
      });
    }

    var json = JSON.stringify(packed);

    return '' +
      "(function(){\n" +
      "  if(!rules || !rules.length) return;\n" +
      "  if(!context || !context.chat) return;\n" +
      "  var mc = (typeof context.chat.message_count === 'number') ? context.chat.message_count : 0;\n" +
      "\n" +
      "  for(var i=0;i<rules.length;i++){\n" +
      "    var r = rules[i]; if(!r) continue;\n" +
      "    if(mc < r.min || mc > r.max) continue;\n" +
      "    if(!r.text) continue;\n" +
      "    var path = String(r.target).replace(/^context\\./,'');\n" +
      "    SBX_R.append(context, path, r.text, r.marker, r.once);\n" +
      "  }\n" +
      "})();\n";
  }

  function updatePreview(rootEl) {
    var ta = $('#ev-preview', rootEl);
    if (!ta) return;
    try {
      var blocks = getExportBlocks(root.StudioState) || [];
      var code = (blocks[0] && blocks[0].code) ? String(blocks[0].code) : '';
      if (!code) {
        ta.value = '/* Events module has no enabled events. */';
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
    renderList(el, data);
    renderEditor(el, data);
    updatePreview(el);

    var btnAdd = $('#ev-add', el);
    var btnDup = $('#ev-dup', el);
    var btnDel = $('#ev-del', el);

    if (btnAdd) btnAdd.onclick = function () {
      addEntry(data);
      renderList(el, data);
      renderEditor(el, data);
      updatePreview(el);
    };
    if (btnDup) btnDup.onclick = function () {
      dupEntry(data);
      renderList(el, data);
      renderEditor(el, data);
      updatePreview(el);
    };
    if (btnDel) btnDel.onclick = function () {
      delEntry(data);
      renderList(el, data);
      renderEditor(el, data);
      updatePreview(el);
    };

    // Copy preview
    var copyBtn = $('#ev-copy', el);
    if (copyBtn) copyBtn.onclick = function () {
      var ta = $('#ev-preview', el);
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

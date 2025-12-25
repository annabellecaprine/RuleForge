/* scoring.panel.js — Scoring (ES5), DSL-first (clean install)
 * Spec:
 * - Reads message history ONLY (historyText.norm)
 * - Message depth
 * - Topic Group Name
 * - Keyword List + filters
 * - Threshold gate: Min (>=) and optional Max (<=) via checkbox
 * - Write target: Personality / Scenario
 * - "Context field" = text to append when gate passes
 *
 * Cleanup:
 * - Removed redundant per-panel lb-* CSS injection (now provided by panels.css)
 * - Avoids full editor re-render on keyword typing / filter toggles (prevents focus loss)
 */
(function (root) {
  'use strict';

  var PANEL_ID = 'scoring';
  var STORE_KEY = 'studio.data.scoring';

  // ---------------------------
  // Helpers
  // ---------------------------
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return (el || document).querySelectorAll(sel); }
  function esc(s) {
    s = (s == null ? '' : String(s));
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uid(prefix) {
    return (prefix || 's') + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
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
  function nonEmpty(s) { return !!trim(s); }

  function ensureStudioState() {
    root.StudioState = root.StudioState || {};
    root.StudioState.data = root.StudioState.data || {};
    if (!root.StudioState.data[PANEL_ID]) root.StudioState.data[PANEL_ID] = defaultData();
    return root.StudioState;
  }

  function defaultData() {
    return {
      version: 4,
      enabled: true,
      topics: [],
      ui: { activeTopicId: null }
    };
  }

  // ---------------------------
  // Data normalize
  // ---------------------------
  function loadData() {
    var st = ensureStudioState();
    var raw = lsGet(STORE_KEY, '');
    if (raw) {
      try {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') st.data[PANEL_ID] = p;
      } catch (_e) { }
    }

    var d = st.data[PANEL_ID] || defaultData();
    d.topics = d.topics || [];
    d.ui = d.ui || { activeTopicId: null };
    if (typeof d.enabled !== 'boolean') d.enabled = true;

    for (var i = 0; i < d.topics.length; i++) {
      var t = d.topics[i];
      if (!t) continue;

      if (!t.id) t.id = uid('t');
      if (typeof t.enabled !== 'boolean') t.enabled = true;

      if (!t.name) t.name = 'Topic Group';
      t.readSourceId = 'historyText.norm';

      t.messageDepth = clampInt(t.messageDepth, 1, 200);

      t.keywordsText = String(t.keywordsText || '');
      t.filters = t.filters || {};
      if (typeof t.filters.caseInsensitive !== 'boolean') t.filters.caseInsensitive = true;
      if (typeof t.filters.wholeWord !== 'boolean') t.filters.wholeWord = true;
      if (typeof t.filters.allowVariants !== 'boolean') t.filters.allowVariants = true;
      if (typeof t.filters.skipNegated !== 'boolean') t.filters.skipNegated = true;

      t.thresholdMin = clampInt(t.thresholdMin, 0, 999);
      if (typeof t.useMax !== 'boolean') t.useMax = false;
      t.thresholdMax = clampInt(t.thresholdMax, 0, 999);
      if (t.useMax && t.thresholdMax < t.thresholdMin) t.thresholdMax = t.thresholdMin;

      t.writeTargetId = (t.writeTargetId === 'character.scenario') ? 'character.scenario' : 'character.personality';
      t.contextFieldText = String(t.contextFieldText || '');
    }

    st.data[PANEL_ID] = d;
    return d;
  }

  function saveData() {
    var st = ensureStudioState();
    lsSet(STORE_KEY, JSON.stringify(st.data[PANEL_ID] || defaultData()));
  }

  function getTopicById(d, id) {
    id = String(id || '');
    for (var i = 0; i < d.topics.length; i++) {
      if (d.topics[i] && d.topics[i].id === id) return d.topics[i];
    }
    return null;
  }

  function ensureActiveTopic(d) {
    if (!d.topics.length) {
      d.ui.activeTopicId = null;
      return;
    }
    var id = d.ui.activeTopicId;
    if (id && getTopicById(d, id)) return;
    d.ui.activeTopicId = d.topics[0].id;
  }

  // ---------------------------
  // Keywords / Scoring
  // ---------------------------
  function splitKeywords(text) {
    text = String(text == null ? '' : text);
    if (!text) return [];
    var parts = text.split(/[\n,]+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = trim(parts[i]);
      if (!s) continue;
      out.push(s);
    }
    return out;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildKeywordRegex(word, filters) {
    var base = escapeRegExp(word);
    var suffix = '';
    if (filters && filters.allowVariants) { suffix = '(?:s|es|ed|ing)?'; }
    if (filters && filters.wholeWord) {
      return new RegExp('\\b' + base + suffix + '\\b', (filters.caseInsensitive ? 'gi' : 'g'));
    }
    return new RegExp(base + suffix, (filters.caseInsensitive ? 'gi' : 'g'));
  }

  function isNegatedNear(text, idx) {
    var start = idx - 12;
    if (start < 0) start = 0;
    var pre = text.slice(start, idx).toLowerCase();
    return (pre.indexOf(' not ') !== -1) || (pre.indexOf(' no ') !== -1) || (pre.indexOf(' never ') !== -1) ||
      (/(\bnot\b|\bno\b|\bnever\b)\s+$/.test(pre));
  }

  function scoreText(text, keywords, filters) {
    text = String(text == null ? '' : text);
    if (!text || !keywords || !keywords.length) return 0;

    var total = 0;
    for (var i = 0; i < keywords.length; i++) {
      var w = keywords[i];
      if (!w) continue;

      var re = buildKeywordRegex(w, filters);
      var m;
      re.lastIndex = 0;

      while ((m = re.exec(text)) !== null) {
        if (filters && filters.skipNegated) {
          if (isNegatedNear(text, m.index)) continue;
        }
        total++;
        if (total > 9999) return total;
      }
    }
    return total;
  }

  // ---------------------------
  // Message history retrieval (UI preview)
  // ---------------------------
  function getHistoryText(depth) {
    depth = clampInt(depth, 1, 200);

    if (root.Sources && typeof root.Sources.get === 'function') {
      try {
        var v = root.Sources.get('historyText.norm', root.StudioState);
        if (v == null) v = '';

        if (Object.prototype.toString.call(v) === '[object Array]') {
          var a = v;
          var start = a.length - depth;
          if (start < 0) start = 0;
          var parts = [];
          for (var i = start; i < a.length; i++) parts.push(String(a[i] == null ? '' : a[i]));
          return parts.join('\n');
        }
        return String(v);
      } catch (_e) { }
    }

    var ctx = root.StudioState && root.StudioState.context ? root.StudioState.context : null;
    if (ctx && ctx.chat && ctx.chat.last_messages && ctx.chat.last_messages.length) {
      var start2 = ctx.chat.last_messages.length - depth;
      if (start2 < 0) start2 = 0;
      var parts2 = [];
      for (var j = start2; j < ctx.chat.last_messages.length; j++) {
        parts2.push(String(ctx.chat.last_messages[j] == null ? '' : ctx.chat.last_messages[j]));
      }
      return parts2.join('\n');
    }
    return '';
  }

  function passesRange(count, minV, useMax, maxV) {
    minV = clampInt(minV, 0, 999);
    maxV = clampInt(maxV, 0, 999);
    if (count < minV) return false;
    if (useMax && count > maxV) return false;
    return true;
  }

  // ---------------------------
  // UI
  // ---------------------------
  function buildShell(el) {
    el.innerHTML =
      '<div class="lb-shell">' +
      '<div class="lb-body">' +
      '<div class="lb-tabs eng-block">' +
      '<div class="eng-h">Scoring Topics</div>' +
      '<div class="lb-tablist" id="sc-topics"></div>' +
      '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn" id="sc-t-add" type="button">Add Topic</button>' +
      '<button class="btn btn-ghost" id="sc-t-dup" type="button">Duplicate</button>' +
      '<button class="btn btn-danger" id="sc-t-del" type="button">Delete</button>' +
      '</div>' +
      '</div>' +
      '<div class="lb-editor eng-block" id="sc-editor"></div>' +
      '</div>' +

      // Full-span preview (mirrors Random)
      '<div class="eng-block" id="sc-preview-wrap" style="margin-top:14px; width:100%;">' +
      '<div class="lb-editor-head" style="margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">' +
      '<div class="eng-h" style="margin:0;">Generated Script (Scoring module)</div>' +
      '<div class="lb-editor-actions" style="display:flex; gap:8px; align-items:center;">' +
      '<button class="btn btn-ghost lb-mini" type="button" id="sc-copy">Copy</button>' +
      '</div>' +
      '</div>' +
      '<div class="eng-muted" style="font-size:12px; margin-bottom:8px;">' +
      'Paste-ready ES5 snippet. Writes to <code>context.character.personality</code> / <code>context.character.scenario</code>.' +
      '</div>' +
      '<textarea id="sc-preview" readonly spellcheck="false" ' +
      'style="width:100%; min-height:320px; resize:vertical; box-sizing:border-box; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></textarea>' +
      '</div>' +

      '</div>';
  }

  function renderTopics(rootEl, d) {
    var host = $('#sc-topics', rootEl);
    if (!host) return;

    if (!d.topics.length) {
      host.innerHTML = '<div class="eng-muted" style="margin-bottom:12px;">(no topics yet)</div>';
      return;
    }

    var html = '';
    var active = d.ui.activeTopicId;

    for (var i = 0; i < d.topics.length; i++) {
      var t = d.topics[i];
      if (!t) continue;

      var on = (t.enabled !== false);
      var minV = clampInt(t.thresholdMin, 0, 999);
      var maxV = clampInt(t.thresholdMax, 0, 999);
      var depth = clampInt(t.messageDepth, 1, 200);
      var tgt = (t.writeTargetId === 'character.scenario') ? 'Scenario' : 'Personality';
      var kw = splitKeywords(t.keywordsText);

      var rangeLabel = (t.useMax ? (minV + '–' + maxV) : ('≥ ' + minV));

      html += ''
        + '<button class="lb-tab' + (t.id === active ? ' is-active' : '') + '" type="button" data-id="' + esc(t.id) + '">'
        + '<div class="lb-tab-top">'
        + '<span class="lb-dot ' + (on ? 'on' : 'off') + '" title="' + (on ? 'Enabled' : 'Disabled') + '"></span>'
        + '<span class="lb-tab-name">' + esc(t.name || 'Topic Group') + '</span>'
        + '</div>'
        + '<div class="lb-tab-meta">'
        + '<span class="lb-chip">' + esc(rangeLabel) + '</span>'
        + '<span class="lb-chip">depth ' + esc(depth) + '</span>'
        + '<span class="lb-chip">→ ' + esc(tgt) + '</span>'
        + '<span class="lb-meta">' + esc(kw.length + ' keywords') + '</span>'
        + '</div>'
        + '</button>';
    }

    host.innerHTML = html;

    var btns = $all('.lb-tab', host);
    for (var b = 0; b < btns.length; b++) {
      btns[b].onclick = function () {
        d.ui.activeTopicId = this.getAttribute('data-id');
        saveData();
        renderAll(rootEl, d);
        updatePreview(rootEl);
      };
    }
  }

  function updateEditorPreviewBits(editorEl, t) {
    if (!editorEl || !t) return;

    var keywords = splitKeywords(t.keywordsText);
    var history = getHistoryText(t.messageDepth);
    var count = scoreText(history, keywords, t.filters);

    var minV = clampInt(t.thresholdMin, 0, 999);
    var maxV = clampInt(t.thresholdMax, 0, 999);
    if (t.useMax && maxV < minV) maxV = minV;

    var passes = passesRange(count, minV, !!t.useMax, maxV);

    var elCount = $('#sc-prev-count', editorEl);
    if (elCount) elCount.textContent = 'preview count: ' + count;

    var elPass = $('#sc-prev-pass', editorEl);
    if (elPass) elPass.textContent = (passes ? 'PASS' : 'FAIL');
  }

  function renderEditor(rootEl, d) {
    var host = $('#sc-editor', rootEl);
    if (!host) return;

    ensureActiveTopic(d);
    var t = d.ui.activeTopicId ? getTopicById(d, d.ui.activeTopicId) : null;

    if (!t) {
      host.innerHTML = '<div class="eng-muted" style="margin-bottom:12px;">Add a topic to begin.</div>';
      return;
    }

    var keywords = splitKeywords(t.keywordsText);
    var history = getHistoryText(t.messageDepth);
    var count = scoreText(history, keywords, t.filters);

    var minV = clampInt(t.thresholdMin, 0, 999);
    var maxV = clampInt(t.thresholdMax, 0, 999);
    if (t.useMax && maxV < minV) maxV = minV;

    var passes = passesRange(count, minV, !!t.useMax, maxV);

    host.innerHTML =
      '<div class="lb-editor-head">' +
      '<div class="eng-h" style="margin:0;">Scoring — ' + esc(t.name || 'Topic Group') + '</div>' +
      '<div class="lb-editor-actions">' +
      '<label class="pill pill-ok" style="cursor:pointer;">' +
      '<input id="sc-enabled" type="checkbox" ' + ((t.enabled !== false) ? 'checked' : '') + '> Enabled' +
      '</label>' +
      '</div>' +
      '</div>' +

      '<div style="margin-top:12px;" class="card">' +
      '<div style="padding:12px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">' +
      '<label class="ctl">Topic group name ' +
      '<input id="sc-name" type="text" value="' + esc(t.name || '') + '" style="min-width:240px;">' +
      '</label>' +

      '<label class="ctl">Min threshold (≥) ' +
      '<input id="sc-min" type="number" min="0" max="999" step="1" value="' + esc(minV) + '" style="width:120px;">' +
      '</label>' +

      '<label class="pill pill-ok" style="cursor:pointer;">' +
      '<input id="sc-useMax" type="checkbox" ' + (t.useMax ? 'checked' : '') + '> Use max gate' +
      '</label>' +

      '<label class="ctl">Max threshold (≤) ' +
      '<input id="sc-max" type="number" min="0" max="999" step="1" value="' + esc(maxV) + '" style="width:120px;" ' + (t.useMax ? '' : 'disabled') + '>' +
      '</label>' +

      '<label class="ctl">Write target ' +
      '<select id="sc-target">' +
      '<option value="character.personality"' + (t.writeTargetId === 'character.personality' ? ' selected' : '') + '>Personality</option>' +
      '<option value="character.scenario"' + (t.writeTargetId === 'character.scenario' ? ' selected' : '') + '>Scenario</option>' +
      '</select>' +
      '</label>' +

      '<label class="ctl">Message depth ' +
      '<input id="sc-depth" type="number" min="1" max="200" step="1" value="' + esc(clampInt(t.messageDepth, 1, 200)) + '" style="width:120px;">' +
      '</label>' +

      '<span class="lb-chip" id="sc-prev-count">preview count: ' + esc(count) + '</span>' +
      '<span class="lb-chip" id="sc-prev-pass">' + (passes ? 'PASS' : 'FAIL') + '</span>' +
      '</div>' +
      '</div>' +

      '<div style="margin-top:12px;" class="card">' +
      '<div style="padding:12px;border-bottom:1px solid var(--border);font-weight:900;">Keywords</div>' +
      '<div style="padding:12px; display:flex; gap:14px; flex-wrap:wrap; align-items:center;">' +
      '<label class="pill pill-ok" style="cursor:pointer;"><input id="sc-f-case" type="checkbox" ' + (t.filters.caseInsensitive ? 'checked' : '') + '> Case-insensitive</label>' +
      '<label class="pill pill-ok" style="cursor:pointer;"><input id="sc-f-word" type="checkbox" ' + (t.filters.wholeWord ? 'checked' : '') + '> Whole-word</label>' +
      '<label class="pill pill-ok" style="cursor:pointer;"><input id="sc-f-var" type="checkbox" ' + (t.filters.allowVariants ? 'checked' : '') + '> Allow variants</label>' +
      '<label class="pill pill-ok" style="cursor:pointer;"><input id="sc-f-neg" type="checkbox" ' + (t.filters.skipNegated ? 'checked' : '') + '> Skip “not/no/never …”</label>' +
      '<span class="eng-muted" style="font-size:12px;">One per line or comma-separated.</span>' +
      '</div>' +
      '<div style="padding:0 12px 12px 12px;">' +
      '<textarea id="sc-keywords" style="width:100%; min-height:110px; resize:vertical;" placeholder="rain&#10;raining&#10;storm">' + esc(t.keywordsText || '') + '</textarea>' +
      '</div>' +
      '</div>' +

      '<div style="margin-top:12px;" class="card">' +
      '<div style="padding:12px;border-bottom:1px solid var(--border);font-weight:900;">Context field</div>' +
      '<div style="padding:12px;">' +
      '<textarea id="sc-contextField" style="width:100%; min-height:100px; resize:vertical;" placeholder="Text to append when gate passes.">' + esc(t.contextFieldText || '') + '</textarea>' +
      '<div class="eng-muted" style="font-size:12px; margin-top:6px;">Appends directly. Repeat freely (no de-dup marker).</div>' +
      '</div>' +
      '</div>';

    // Wire
    $('#sc-enabled', host).onchange = function () {
      t.enabled = !!this.checked;
      saveData();
      renderTopics(rootEl, d);
      updatePreview(rootEl);
    };

    // NOTE: do not re-render editor on typing
    $('#sc-name', host).oninput = function () {
      t.name = this.value;
      saveData();
      renderTopics(rootEl, d);
      updatePreview(rootEl);
    };

    $('#sc-min', host).oninput = function () {
      t.thresholdMin = clampInt(this.value, 0, 999);
      if (t.useMax && t.thresholdMax < t.thresholdMin) t.thresholdMax = t.thresholdMin;
      saveData();
      renderTopics(rootEl, d);
      renderEditor(rootEl, d); // ok: affects gating + possibly max correction
      updatePreview(rootEl);
    };

    $('#sc-useMax', host).onchange = function () {
      t.useMax = !!this.checked;
      if (t.useMax && t.thresholdMax < t.thresholdMin) t.thresholdMax = t.thresholdMin;
      saveData();
      renderTopics(rootEl, d);
      renderEditor(rootEl, d); // ok: enables/disables max input
      updatePreview(rootEl);
    };

    $('#sc-max', host).oninput = function () {
      t.thresholdMax = clampInt(this.value, 0, 999);
      if (t.useMax && t.thresholdMax < t.thresholdMin) t.thresholdMax = t.thresholdMin;
      saveData();
      renderTopics(rootEl, d);
      renderEditor(rootEl, d); // ok: affects gating
      updatePreview(rootEl);
    };

    $('#sc-target', host).onchange = function () {
      var v = this.value || 'character.personality';
      if (v !== 'character.personality' && v !== 'character.scenario') v = 'character.personality';
      t.writeTargetId = v;
      saveData();
      renderTopics(rootEl, d);
      updatePreview(rootEl);
    };

    $('#sc-depth', host).oninput = function () {
      t.messageDepth = clampInt(this.value, 1, 200);
      saveData();
      renderTopics(rootEl, d);
      renderEditor(rootEl, d); // ok: preview depends on depth
      updatePreview(rootEl);
    };

    // Filters: update preview bits without full re-render (keeps cursor in textarea)
    $('#sc-f-case', host).onchange = function () { t.filters.caseInsensitive = !!this.checked; saveData(); updateEditorPreviewBits(host, t); updatePreview(rootEl); };
    $('#sc-f-word', host).onchange = function () { t.filters.wholeWord = !!this.checked; saveData(); updateEditorPreviewBits(host, t); updatePreview(rootEl); };
    $('#sc-f-var', host).onchange = function () { t.filters.allowVariants = !!this.checked; saveData(); updateEditorPreviewBits(host, t); updatePreview(rootEl); };
    $('#sc-f-neg', host).onchange = function () { t.filters.skipNegated = !!this.checked; saveData(); updateEditorPreviewBits(host, t); updatePreview(rootEl); };

    // Keywords: do NOT re-render editor on each keypress (prevents focus loss)
    $('#sc-keywords', host).oninput = function () {
      t.keywordsText = this.value;
      saveData();
      renderTopics(rootEl, d);
      updateEditorPreviewBits(host, t);
      updatePreview(rootEl);
    };

    $('#sc-contextField', host).oninput = function () {
      t.contextFieldText = this.value;
      saveData();
      updatePreview(rootEl);
    };
  }

  function renderAll(rootEl, d) {
    renderTopics(rootEl, d);
    renderEditor(rootEl, d);
  }

  // Toolbar
  function addTopic(d) {
    var t = {
      id: uid('t'),
      enabled: true,
      name: 'Topic Group',
      readSourceId: 'historyText.norm',
      messageDepth: 12,
      keywordsText: '',
      filters: { caseInsensitive: true, wholeWord: true, allowVariants: true, skipNegated: true },
      thresholdMin: 3,
      useMax: false,
      thresholdMax: 6,
      writeTargetId: 'character.personality',
      contextFieldText: ''
    };
    d.topics.unshift(t);
    d.ui.activeTopicId = t.id;
    saveData();
  }

  function dupTopic(d) {
    ensureActiveTopic(d);
    var src = d.ui.activeTopicId ? getTopicById(d, d.ui.activeTopicId) : null;
    if (!src) return;
    var c = clone(src);
    c.id = uid('t');
    c.name = (c.name || 'Topic Group') + ' (Copy)';
    c.readSourceId = 'historyText.norm';
    if (c.useMax && c.thresholdMax < c.thresholdMin) c.thresholdMax = c.thresholdMin;
    d.topics.unshift(c);
    d.ui.activeTopicId = c.id;
    saveData();
  }

  function delTopic(d) {
    ensureActiveTopic(d);
    var id = d.ui.activeTopicId;
    if (!id) return;
    if (!confirm('Delete this topic group?')) return;

    var idx = -1;
    for (var i = 0; i < d.topics.length; i++) {
      if (d.topics[i] && d.topics[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    d.topics.splice(idx, 1);
    ensureActiveTopic(d);
    saveData();
  }

  // ---------------------------
  // DSL hooks
  // ---------------------------
  function getRuleSpecs(studioState) {
    studioState = studioState || ensureStudioState();
    var d = (studioState.data && studioState.data[PANEL_ID]) ? studioState.data[PANEL_ID] : defaultData();
    if (d.enabled === false) return [];

    var out = [];
    for (var i = 0; i < (d.topics || []).length; i++) {
      var t = d.topics[i];
      if (!t || t.enabled === false) continue;

      var kw = splitKeywords(t.keywordsText);
      if (!kw.length) continue;

      var minV = clampInt(t.thresholdMin, 0, 999);
      var maxV = clampInt(t.thresholdMax, 0, 999);
      var useMax = !!t.useMax;
      if (useMax && maxV < minV) maxV = minV;

      var depth = clampInt(t.messageDepth, 1, 200);
      var ctxField = String(t.contextFieldText || '');
      if (!ctxField) continue;

      var targetId = t.writeTargetId || 'character.personality';
      if (targetId !== 'character.personality' && targetId !== 'character.scenario') targetId = 'character.personality';

      out.push({
        id: 'scoring:topic:' + t.id,
        moduleId: PANEL_ID,
        enabled: true,
        label: 'Scoring — ' + (t.name || 'Topic'),
        read: {
          sourceId: 'historyText.norm',
          messageDepth: depth
        },
        match: {
          type: 'keywordCountRange',
          keywords: kw,
          filters: {
            caseInsensitive: !!(t.filters && t.filters.caseInsensitive),
            wholeWord: !!(t.filters && t.filters.wholeWord),
            allowVariants: !!(t.filters && t.filters.allowVariants),
            skipNegated: !!(t.filters && t.filters.skipNegated)
          },
          min: minV,
          useMax: useMax,
          max: useMax ? maxV : null
        },
        write: {
          targetId: targetId,
          mode: 'append',
          text: ctxField
        }
      });
    }
    return out;
  }

  function getWriteTargets() {
    return ['context.character.personality', 'context.character.scenario'];
  }

  // ---------------------------
  // Export + Viewer (mirrors Random)
  // ---------------------------
  function getExportBlocks(studioState) {
    var rules = getRuleSpecs(studioState);
    return [{
      kind: 'script',
      id: 'scoring.module',
      code: emitES5(rules)
    }];
  }

  function emitES5(rules) {
    if (!rules || !rules.length) return '';
    var json = JSON.stringify(rules);

    return ''
    "(function(){\n" +
      "  'use strict';\n" +
      "  var RULES = " + json + ";\n" +
      "\n" +
      "  function buildKeywordRegex(word, filters){\n" +
      "    var base = SBX_R.escRegex(word);\n" +
      "    var suffix = '';\n" +
      "    if (filters && filters.allowVariants){ suffix = '(?:s|es|ed|ing)?'; }\n" +
      "    if (filters && filters.wholeWord){\n" +
      "      return new RegExp('\\\\b' + base + suffix + '\\\\b', (filters.caseInsensitive ? 'gi' : 'g'));\n" +
      "    }\n" +
      "    return new RegExp(base + suffix, (filters.caseInsensitive ? 'gi' : 'g'));\n" +
      "  }\n" +
      "  function isNegatedNear(text, idx){\n" +
      "    var start = idx - 12;\n" +
      "    if (start < 0) start = 0;\n" +
      "    var pre = text.slice(start, idx).toLowerCase();\n" +
      "    return (pre.indexOf(' not ') !== -1) || (pre.indexOf(' no ') !== -1) || (pre.indexOf(' never ') !== -1) ||\n" +
      "           (/(\\\\bnot\\\\b|\\\\bno\\\\b|\\\\bnever\\\\b)\\\\s+$/.test(pre));\n" +
      "  }\n" +
      "  function scoreText(text, keywords, filters){\n" +
      "    text = String(text==null?'':text);\n" +
      "    if (!text || !keywords || !keywords.length) return 0;\n" +
      "    var total = 0;\n" +
      "    for (var i=0;i<keywords.length;i++){\n" +
      "      var w = keywords[i];\n" +
      "      if (!w) continue;\n" +
      "      var re = buildKeywordRegex(w, filters);\n" +
      "      var m;\n" +
      "      re.lastIndex = 0;\n" +
      "      while ((m = re.exec(text)) !== null){\n" +
      "        if (filters && filters.skipNegated){\n" +
      "          if (isNegatedNear(text, m.index)) continue;\n" +
      "        }\n" +
      "        total++;\n" +
      "        if (total > 9999) return total;\n" +
      "      }\n" +
      "    }\n" +
      "    return total;\n" +
      "  }\n" +
      "  function passesRange(count, minV, useMax, maxV){\n" +
      "    minV = SBX_R.clamp(minV, 0, 999);\n" +
      "    maxV = SBX_R.clamp(maxV, 0, 999);\n" +
      "    if (count < minV) return false;\n" +
      "    if (useMax && count > maxV) return false;\n" +
      "    return true;\n" +
      "  }\n" +
      "\n" +
      "  for (var i=0;i<RULES.length;i++){\n" +
      "    var r = RULES[i];\n" +
      "    if (!r || r.enabled === false) continue;\n" +
      "    if (!r.read || r.read.sourceId !== 'historyText.norm') continue;\n" +
      "    if (!r.match || r.match.type !== 'keywordCountRange') continue;\n" +
      "    var text = SBX_R.getLastMsgs(context, r.read.messageDepth || 12);\n" +
      "    var count = scoreText(text, r.match.keywords || [], r.match.filters || {});\n" +
      "    if (!passesRange(count, r.match.min||0, !!r.match.useMax, r.match.max||0)) continue;\n" +
      "    var target = (r.write && r.write.targetId) ? r.write.targetId : 'character.personality';\n" +
      "    if (target.indexOf('context.') === 0) target = target.replace('context.', '');\n" +
      "    SBX_R.append(context, target, (r.write && r.write.text) ? r.write.text : '');\n" +
      "  }\n" +
      "})();\n";
  }

  function updatePreview(rootEl) {
    var ta = $('#sc-preview', rootEl);
    if (!ta) return;
    try {
      var blocks = getExportBlocks(root.StudioState) || [];
      var code = (blocks[0] && blocks[0].code) ? String(blocks[0].code) : '';
      if (!code) {
        ta.value = '/* Scoring module has no enabled rules. */';
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
  function mount(el) {
    var d = loadData();
    ensureActiveTopic(d);

    buildShell(el);
    renderAll(el, d);
    updatePreview(el);

    $('#sc-t-add', el).onclick = function () { addTopic(d); renderAll(el, d); updatePreview(el); };
    $('#sc-t-dup', el).onclick = function () { dupTopic(d); renderAll(el, d); updatePreview(el); };
    $('#sc-t-del', el).onclick = function () { delTopic(d); renderAll(el, d); updatePreview(el); };

    // Copy preview
    var copyBtn = $('#sc-copy', el);
    if (copyBtn) copyBtn.onclick = function () {
      var ta = $('#sc-preview', el);
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

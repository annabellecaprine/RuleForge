/* ambient.panel.js — Ambient Environmentals (ES5), DSL-first
 * Spec:
 * - Scenario ONLY (environmental flavor)
 * - Repeat freely (no de-dup markers)
 * - Groups: left tabs (Lorebook-style)
 * - Items: right nested split (Random-style layout via panels.css .rnd-*)
 * - Group chance % per turn, then weighted item pick
 *
 * UX:
 * - Auto-save (no per-panel save button)
 * - Code output block (Generated Script) + Copy button
 *
 * CSS:
 * - NO injected CSS here.
 * - Relies on global panels.css for .lb-* and .rnd-* layout.
 */
(function (root) {
  'use strict';

  var PANEL_ID = 'ambient';
  var STORE_KEY = 'studio.data.ambient';

  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return (el || document).querySelectorAll(sel); }
  function escHtml(s) {
    s = (s == null ? '' : String(s));
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uid(prefix) {
    return (prefix || 'a') + Math.random().toString(16).slice(2) + Date.now().toString(16);
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
  function nonEmpty(s) { return !!trim(s).replace(/\s+/g, '').length; }

  function ensureStudioState() {
    root.StudioState = root.StudioState || {};
    root.StudioState.data = root.StudioState.data || {};
    if (!root.StudioState.data[PANEL_ID]) root.StudioState.data[PANEL_ID] = defaultData();
    return root.StudioState;
  }

  function defaultData() {
    return {
      version: 2,
      enabled: true,
      groups: [],
      ui: { activeGroupId: null }
    };
  }

  function getGroupById(data, id) {
    for (var i = 0; i < (data.groups || []).length; i++) {
      if (data.groups[i] && data.groups[i].id === id) return data.groups[i];
    }
    return null;
  }

  function getItemById(group, id) {
    for (var i = 0; i < (group.items || []).length; i++) {
      if (group.items[i] && group.items[i].id === id) return group.items[i];
    }
    return null;
  }

  function ensureActiveGroup(data) {
    if (data.ui && data.ui.activeGroupId && getGroupById(data, data.ui.activeGroupId)) return;
    data.ui = data.ui || {};
    data.ui.activeGroupId = (data.groups[0] && data.groups[0].id) ? data.groups[0].id : null;
  }

  function ensureActiveItem(group) {
    group.ui = group.ui || {};
    if (group.ui.activeItemId && getItemById(group, group.ui.activeItemId)) return;
    group.ui.activeItemId = (group.items[0] && group.items[0].id) ? group.items[0].id : null;
  }

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
    d.groups = d.groups || [];
    d.ui = d.ui || { activeGroupId: null };
    if (typeof d.enabled !== 'boolean') d.enabled = true;

    for (var i = 0; i < d.groups.length; i++) {
      var g = d.groups[i];
      if (!g) continue;

      if (!g.id) g.id = uid('g');
      if (typeof g.enabled !== 'boolean') g.enabled = true;
      if (!g.name) g.name = 'Ambient Group';

      if (g.triggerChancePct == null) g.triggerChancePct = 10;
      g.triggerChancePct = clampInt(g.triggerChancePct, 0, 100);

      g.items = g.items || [];
      g.ui = g.ui || { activeItemId: null };

      for (var j = 0; j < g.items.length; j++) {
        var it = g.items[j];
        if (!it) continue;
        if (!it.id) it.id = uid('i');
        if (typeof it.enabled !== 'boolean') it.enabled = true;
        if (it.weightPct == null) it.weightPct = 0;
        it.weightPct = clampInt(it.weightPct, 0, 100);
        if (it.text == null) it.text = '';
        if (it.name == null) it.name = '';
      }

      ensureActiveItem(g);
      normalizeWeights(g, null);
    }

    ensureActiveGroup(d);
    st.data[PANEL_ID] = d;
    return d;
  }

  function saveData() {
    var st = ensureStudioState();
    lsSet(STORE_KEY, JSON.stringify(st.data[PANEL_ID] || defaultData()));
  }

  // Weight normalization (locked 100% among enabled)
  function normalizeWeights(group, changedItemId) {
    var items = group.items || [];
    var enabled = [];
    var i;

    for (i = 0; i < items.length; i++) {
      if (!items[i]) continue;
      if (items[i].enabled === false) {
        items[i].weightPct = 0;
      } else {
        enabled.push(items[i]);
      }
    }

    if (!enabled.length) return;

    if (enabled.length === 1) {
      enabled[0].weightPct = 100;
      return;
    }

    var changed = null;
    for (i = 0; i < enabled.length; i++) {
      if (enabled[i].id === changedItemId) { changed = enabled[i]; break; }
    }

    if (!changed) {
      var total0 = 0;
      for (i = 0; i < enabled.length; i++) total0 += clampInt(enabled[i].weightPct, 0, 100);

      if (total0 <= 0) {
        var base = Math.floor(100 / enabled.length);
        var rem = 100 - (base * enabled.length);
        for (i = 0; i < enabled.length; i++) {
          enabled[i].weightPct = base + (i === enabled.length - 1 ? rem : 0);
        }
        return;
      }

      var accum = 0;
      for (i = 0; i < enabled.length; i++) {
        var w = clampInt(enabled[i].weightPct, 0, 100);
        var scaled = Math.floor((w / total0) * 100);
        enabled[i].weightPct = scaled;
        accum += scaled;
      }
      enabled[enabled.length - 1].weightPct += (100 - accum);
      return;
    }

    changed.weightPct = clampInt(changed.weightPct, 0, 100);

    var remaining = 100 - changed.weightPct;
    if (remaining < 0) remaining = 0;

    var others = [];
    var sumOthers = 0;
    for (i = 0; i < enabled.length; i++) {
      if (enabled[i].id === changed.id) continue;
      others.push(enabled[i]);
      sumOthers += clampInt(enabled[i].weightPct, 0, 100);
    }

    if (!others.length) {
      changed.weightPct = 100;
      return;
    }

    if (sumOthers <= 0) {
      var base2 = Math.floor(remaining / others.length);
      var rem2 = remaining - (base2 * others.length);
      for (i = 0; i < others.length; i++) {
        others[i].weightPct = base2 + (i === others.length - 1 ? rem2 : 0);
      }
      return;
    }

    var accum2 = 0;
    for (i = 0; i < others.length; i++) {
      var w2 = clampInt(others[i].weightPct, 0, 100);
      var scaled2 = Math.floor((w2 / sumOthers) * remaining);
      others[i].weightPct = scaled2;
      accum2 += scaled2;
    }
    others[others.length - 1].weightPct += (remaining - accum2);
  }

  function itemLabel(it, index) {
    var nm = it && it.name ? trim(it.name) : '';
    if (nm) return nm;
    return 'Item ' + (index + 1);
  }

  // ---------------------------
  // UI
  // ---------------------------
  function buildShell(el) {
    el.innerHTML =
      '<div class="lb-shell">' +
      '<div class="lb-body">' +

      '<div class="lb-tabs eng-block">' +
      '<div class="eng-h">Ambient Groups</div>' +
      '<div class="lb-tablist" id="amb-groups"></div>' +
      '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn" id="amb-g-add" type="button">Add Group</button>' +
      '<button class="btn btn-ghost" id="amb-g-dup" type="button">Duplicate</button>' +
      '<button class="btn btn-danger" id="amb-g-del" type="button">Delete</button>' +
      '</div>' +
      '</div>' +

      '<div class="lb-editor eng-block" id="amb-editor"></div>' +

      '</div>' +

      // Full-width code preview
      '<div class="eng-block" id="amb-preview-wrap" style="margin-top:14px; width:100%;">' +
      '<div class="lb-editor-head" style="margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">' +
      '<div class="eng-h" style="margin:0;">Generated Script (Ambient module)</div>' +
      '<div class="lb-editor-actions" style="display:flex; gap:8px; align-items:center;">' +
      '<button class="btn btn-ghost lb-mini" type="button" id="amb-copy">Copy</button>' +
      '</div>' +
      '</div>' +
      '<div class="eng-muted" style="font-size:12px; margin-bottom:8px;">' +
      'Paste-ready ES5 snippet. Writes to <code>context.character.scenario</code>.' +
      '</div>' +
      '<textarea id="amb-preview" readonly spellcheck="false" ' +
      'style="width:100%; min-height:280px; resize:vertical; box-sizing:border-box; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></textarea>' +
      '</div>' +

      '</div>';
  }

  function renderGroups(rootEl, data) {
    var host = $('#amb-groups', rootEl);
    if (!host) return;

    if (!data.groups.length) {
      host.innerHTML = '<div class="eng-muted" style="margin-bottom:12px;">(no groups yet)</div>' +
        '<button class="btn btn-primary" type="button" id="amb-g-add-empty">+ Add Your First Group</button>';
      var btnAddEmpty = $('#amb-g-add-empty', host);
      if (btnAddEmpty) btnAddEmpty.onclick = function () {
        var btnAddOriginal = $('#amb-g-add', rootEl);
        if (btnAddOriginal) btnAddOriginal.click();
      };
      return;
    }

    var html = '';
    var active = data.ui.activeGroupId;

    for (var i = 0; i < data.groups.length; i++) {
      var g = data.groups[i];
      if (!g) continue;

      var on = (g.enabled !== false);
      var name = g.name || 'Ambient Group';
      var pct = clampInt(g.triggerChancePct, 0, 100);

      var enabledCount = 0;
      for (var j = 0; j < (g.items || []).length; j++) {
        if (g.items[j] && g.items[j].enabled !== false && nonEmpty(g.items[j].text)) enabledCount++;
      }

      html += '' +
        '<button class="lb-tab' + (g.id === active ? ' is-active' : '') + '" type="button" data-id="' + escHtml(g.id) + '">' +
        '<div class="lb-tab-top">' +
        '<span class="lb-dot ' + (on ? 'on' : 'off') + '" aria-hidden="true" title="' + (on ? 'Enabled' : 'Disabled') + '"></span>' +
        '<span class="lb-tab-name">' + escHtml(name) + '</span>' +
        '</div>' +
        '<div class="lb-tab-meta">' +
        '<span class="lb-chip">' + escHtml(pct + '%') + '</span>' +
        '<span class="lb-meta">' + escHtml(enabledCount + ' items') + '</span>' +
        '</div>' +
        '</button>';
    }

    host.innerHTML = html;

    var rows = $all('.lb-tab', host);
    for (var r = 0; r < rows.length; r++) {
      rows[r].onclick = function () {
        data.ui.activeGroupId = this.getAttribute('data-id');
        saveData();
        renderAll(rootEl, data);
      };
    }
  }

  function renderEditor(rootEl, data) {
    var host = $('#amb-editor', rootEl);
    if (!host) return;

    ensureActiveGroup(data);
    var g = data.ui.activeGroupId ? getGroupById(data, data.ui.activeGroupId) : null;
    if (!g) {
      host.innerHTML = '<div class="eng-muted">Add a group to begin.</div>';
      return;
    }

    ensureActiveItem(g);
    normalizeWeights(g, null);

    var groupOn = (g.enabled !== false);
    var groupName = g.name || 'Ambient Group';
    var chance = clampInt(g.triggerChancePct, 0, 100);

    var items = g.items || [];
    var items = g.items || [];
    var itemTabs = '';
    if (!items.length) {
      itemTabs = '<div class="eng-muted" style="margin-bottom:12px;">(no items yet)</div>' +
        '<button class="btn btn-primary" type="button" id="amb-i-add-empty">+ Add Your First Item</button>';
    } else {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        var on = (it.enabled !== false);
        var isActive = (g.ui.activeItemId === it.id);
        var label = itemLabel(it, i);
        var w = clampInt(it.weightPct, 0, 100);
        var preview = it.text ? String(it.text).slice(0, 50) : '';

        itemTabs += '' +
          '<button class="lb-tab' + (isActive ? ' is-active' : '') + '" type="button" data-item="' + escHtml(it.id) + '">' +
          '<div class="lb-tab-top">' +
          '<span class="lb-dot ' + (on ? 'on' : 'off') + '" aria-hidden="true" title="' + (on ? 'Enabled' : 'Disabled') + '"></span>' +
          '<span class="lb-tab-name">' + escHtml(label) + '</span>' +
          '</div>' +
          '<div class="lb-tab-meta">' +
          '<span class="lb-chip">' + escHtml(w + '%') + '</span>' +
          (preview ? '<span class="lb-meta">' + escHtml(preview) + '</span>' : '<span class="lb-meta">(empty)</span>') +
          '</div>' +
          '</button>';
      }
    }

    var itA = g.ui.activeItemId ? getItemById(g, g.ui.activeItemId) : null;
    if (!itA && items[0]) { itA = items[0]; g.ui.activeItemId = itA.id; }

    var itOn = itA ? (itA.enabled !== false) : true;
    var itW = itA ? clampInt(itA.weightPct, 0, 100) : 0;
    var itText = itA ? (itA.text || '') : '';
    var itName = itA ? (itA.name || '') : '';

    var sum = 0;
    for (var s = 0; s < items.length; s++) {
      if (items[s] && items[s].enabled !== false) sum += clampInt(items[s].weightPct, 0, 100);
    }

    host.innerHTML =
      '<div class="lb-editor-head">' +
      '<div class="eng-h" style="margin:0;">Ambient — ' + escHtml(groupName) + '</div>' +
      '<div class="lb-editor-actions">' +
      '<label class="pill pill-ok" style="cursor:pointer;">' +
      '<input id="amb-g-enabled" type="checkbox" ' + (groupOn ? 'checked' : '') + ' /> Enabled' +
      '</label>' +
      '</div>' +
      '</div>' +

      '<div style="margin-top:12px;">' +
      '<div class="card" style="padding:12px;">' +
      '<div class="row" style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">' +
      '<label class="ctl">Group name ' +
      '<input id="amb-g-name" type="text" value="' + escHtml(groupName) + '" style="min-width:260px;">' +
      '</label>' +
      '<label class="ctl">Trigger chance (%) ' +
      '<input id="amb-g-chance" type="number" min="0" max="100" step="1" value="' + chance + '" style="width:120px;">' +
      '</label>' +
      '<span class="eng-muted" style="font-size:12px;">Rolls each turn. If it hits, an item is chosen by weight.</span>' +
      '</div>' +
      '</div>' +
      '</div>' +

      '<div style="margin-top:12px;" class="card">' +
      '<div style="padding:12px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;">' +
      '<div style="font-weight:900;">Items (weights locked to 100%)</div>' +
      '<div class="eng-muted" style="font-size:12px;">Enabled sum: ' + escHtml(sum + '%') + '</div>' +
      '</div>' +

      // Random-style split layout (via panels.css .rnd-*)
      '<div class="rnd-split">' +
      '<div class="rnd-items">' +
      '<div class="lb-tablist" id="amb-items">' + itemTabs + '</div>' +
      '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn" id="amb-i-add" type="button">Add Item</button>' +
      '<button class="btn btn-ghost" id="amb-i-dup" type="button">Duplicate</button>' +
      '<button class="btn btn-danger" id="amb-i-del" type="button">Delete</button>' +
      '</div>' +
      '</div>' +

      '<div class="rnd-item-editor">' +
      (itA ? (
        '<div class="lb-editor-head" style="padding:0; margin-bottom:10px;">' +
        '<div class="eng-h" style="margin:0;">Item</div>' +
        '<div class="lb-editor-actions">' +
        '<label class="pill pill-ok" style="cursor:pointer;">' +
        '<input id="amb-i-enabled" type="checkbox" ' + (itOn ? 'checked' : '') + ' /> Enabled' +
        '</label>' +
        '</div>' +
        '</div>' +

        '<div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">' +
        '<label class="ctl">Name ' +
        '<input id="amb-i-name" type="text" value="' + escHtml(itName) + '" style="min-width:240px;">' +
        '</label>' +
        '<label class="ctl">Weight (%) ' +
        '<input id="amb-i-weight" type="number" min="0" max="100" step="1" value="' + itW + '" style="width:120px;">' +
        '</label>' +
        '</div>' +

        '<div class="eng-muted" style="font-size:12px; margin-top:6px;">Changing weight auto-balances other enabled items to keep total = 100.</div>' +

        '<div style="margin-top:10px;">' +
        '<label style="display:block; font-weight:600;">Ambient text (Scenario)</label>' +
        '<textarea id="amb-i-text" style="width:100%; min-height:140px; resize:vertical;" placeholder="A gentle breeze rustles the curtains.">' + escHtml(itText) + '</textarea>' +
        '</div>' +

        '<div class="eng-muted" style="font-size:12px; margin-top:8px;">Repeat freely. No de-dup markers.</div>'
      ) : '<div class="eng-muted" style="padding:12px; margin-bottom:12px;">Add an item to begin.</div>') +
      '</div>' +
      '</div>' +
      '</div>';

    // Group controls (auto-save)
    $('#amb-g-enabled', host).onchange = function () {
      g.enabled = !!this.checked;
      saveData();
      renderAll(rootEl, data);
    };
    $('#amb-g-name', host).oninput = function () {
      g.name = this.value;
      saveData();
      renderGroups(rootEl, data);
      updatePreview(rootEl);
    };
    $('#amb-g-chance', host).oninput = function () {
      g.triggerChancePct = clampInt(this.value, 0, 100);
      saveData();
      renderGroups(rootEl, data);
      updatePreview(rootEl);
    };

    // Item tabs
    var itemTabEls = $all('#amb-items .lb-tab', host);
    for (var t = 0; t < itemTabEls.length; t++) {
      itemTabEls[t].onclick = function () {
        var id = this.getAttribute('data-item');
        g.ui.activeItemId = id;
        saveData();
        renderEditor(rootEl, data);
        updatePreview(rootEl);
      };
    }

    // Item toolbar
    var btnAdd = $('#amb-i-add', host);
    var btnDup = $('#amb-i-dup', host);
    var btnDel = $('#amb-i-del', host);

    if (btnAdd) btnAdd.onclick = function () {
      var it = { id: uid('i'), enabled: true, weightPct: 0, text: '', name: '' };
      g.items.push(it);
      g.ui.activeItemId = it.id;
      normalizeWeights(g, null);
      saveData();
      renderEditor(rootEl, data);
      renderGroups(rootEl, data);
      updatePreview(rootEl);
    };

    var btnAddEmptyI = $('#amb-i-add-empty', host);
    if (btnAddEmptyI) btnAddEmptyI.onclick = function () {
      if (btnAdd) btnAdd.click();
    };

    if (btnDup) btnDup.onclick = function () {
      var src = g.ui.activeItemId ? getItemById(g, g.ui.activeItemId) : null;
      if (!src) return;
      var c = clone(src);
      c.id = uid('i');
      g.items.push(c);
      g.ui.activeItemId = c.id;
      normalizeWeights(g, null);
      saveData();
      renderEditor(rootEl, data);
      renderGroups(rootEl, data);
      updatePreview(rootEl);
    };

    if (btnDel) btnDel.onclick = function () {
      if (!g.items.length) return;
      var id = g.ui.activeItemId;
      if (!id) return;
      if (!confirm('Delete this item?')) return;

      var idx = -1;
      for (var k = 0; k < g.items.length; k++) {
        if (g.items[k] && g.items[k].id === id) { idx = k; break; }
      }
      if (idx < 0) return;
      g.items.splice(idx, 1);
      ensureActiveItem(g);
      normalizeWeights(g, null);
      saveData();
      renderEditor(rootEl, data);
      renderGroups(rootEl, data);
      updatePreview(rootEl);
    };

    // Item editor controls (auto-save)
    if (itA) {
      $('#amb-i-enabled', host).onchange = function () {
        itA.enabled = !!this.checked;
        normalizeWeights(g, itA.id);
        saveData();
        renderEditor(rootEl, data);
        renderGroups(rootEl, data);
        updatePreview(rootEl);
      };

      $('#amb-i-weight', host).oninput = function () {
        itA.weightPct = clampInt(this.value, 0, 100);
        normalizeWeights(g, itA.id);
        saveData();
        renderEditor(rootEl, data);
        renderGroups(rootEl, data);
        updatePreview(rootEl);
      };

      $('#amb-i-name', host).oninput = function () {
        itA.name = this.value;
        saveData();
        renderEditor(rootEl, data);
        updatePreview(rootEl);
      };

      $('#amb-i-text', host).oninput = function () {
        itA.text = this.value;
        saveData();
        renderGroups(rootEl, data);
        updatePreview(rootEl);
      };
    }
  }

  function renderAll(rootEl, data) {
    renderGroups(rootEl, data);
    renderEditor(rootEl, data);
    updatePreview(rootEl);
  }

  // ---------------------------
  // Group toolbar ops
  // ---------------------------
  function addGroup(data) {
    var g = {
      id: uid('g'),
      enabled: true,
      name: 'Ambient Group',
      triggerChancePct: 15,
      items: [
        { id: uid('i'), enabled: true, weightPct: 100, text: '', name: '' }
      ],
      ui: { activeItemId: null }
    };
    ensureActiveItem(g);
    data.groups.unshift(g);
    data.ui.activeGroupId = g.id;
    saveData();
  }

  function dupGroup(data) {
    ensureActiveGroup(data);
    var src = data.ui.activeGroupId ? getGroupById(data, data.ui.activeGroupId) : null;
    if (!src) return;
    var c = clone(src);
    c.id = uid('g');
    c.name = (c.name || 'Ambient Group') + ' (Copy)';
    c.ui = c.ui || { activeItemId: null };
    c.items = c.items || [];
    for (var i = 0; i < c.items.length; i++) {
      if (c.items[i]) c.items[i].id = uid('i');
    }
    ensureActiveItem(c);
    normalizeWeights(c, null);
    data.groups.unshift(c);
    data.ui.activeGroupId = c.id;
    saveData();
  }

  function delGroup(data) {
    ensureActiveGroup(data);
    var id = data.ui.activeGroupId;
    if (!id) return;

    var idx = -1;
    for (var i = 0; i < data.groups.length; i++) {
      if (data.groups[i] && data.groups[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    if (!confirm('Delete this ambient group?')) return;

    data.groups.splice(idx, 1);
    ensureActiveGroup(data);
    saveData();
  }

  // ---------------------------
  // DSL: one spec per group (Scenario only)
  // ---------------------------
  function getRuleSpecs(studioState) {
    studioState = studioState || ensureStudioState();
    var d = (studioState.data && studioState.data[PANEL_ID]) ? studioState.data[PANEL_ID] : defaultData();
    if (d.enabled === false) return [];

    var out = [];
    for (var i = 0; i < (d.groups || []).length; i++) {
      var g = d.groups[i];
      if (!g || g.enabled === false) continue;

      var pct = clampInt(g.triggerChancePct, 0, 100);
      if (pct <= 0) continue;

      normalizeWeights(g, null);

      var items = [];
      var enabled = (g.items || []);
      for (var j = 0; j < enabled.length; j++) {
        var it = enabled[j];
        if (!it || it.enabled === false) continue;
        if (!nonEmpty(it.text)) continue;
        var w = clampInt(it.weightPct, 0, 100);
        if (w <= 0) continue;
        items.push({
          id: it.id,
          pct: w,
          name: String(it.name || ''),
          text: String(it.text)
        });
      }
      if (!items.length) continue;

      out.push({
        id: 'ambient:group:' + g.id,
        moduleId: PANEL_ID,
        enabled: true,
        label: 'Ambient — ' + (g.name || 'Group'),
        when: { sourceId: 'chat.messageCount', match: { type: 'chance', pct: pct } },
        pick: { type: 'weighted', locked100: true, items: items },
        write: { targetId: 'character.scenario' }
      });
    }
    return out;
  }

  function getWriteTargets() {
    return ['context.character.scenario'];
  }

  function getExportBlocks(studioState) {
    var rules = getRuleSpecs(studioState);
    var code = emitES5FromAmbientRuleSpecs(rules);
    return [{ kind: 'script', id: 'ambient.basic', code: code }];
  }

  function emitES5FromAmbientRuleSpecs(rules) {
    if (!rules || !rules.length) return '';
    var packed = [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r || r.enabled === false) continue;
      var pct = (r.when && r.when.match) ? clampInt(r.when.match.pct, 0, 100) : 0;
      if (pct <= 0) continue;
      var items = (r.pick && r.pick.items) ? r.pick.items : [];
      if (!items || !items.length) continue;

      var pItems = [];
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (!it) continue;
        var w = clampInt(it.pct, 0, 100);
        if (w <= 0) continue;
        pItems.push({ pct: w, text: String(it.text || '') });
      }
      if (!pItems.length) continue;

      packed.push({ pct: pct, items: pItems });
    }

    var json = JSON.stringify(packed);

    return ''
      + "(function(){\n"
      + "  var groups = " + json + ";\n"
      + "  if(!groups || !groups.length) return;\n"
      + "\n"
      + "  for(var gi=0;gi<groups.length;gi++){\n"
      + "    var g = groups[gi];\n"
      + "    if(!g) continue;\n"
      + "    if(!SBX_R.roll(g.pct)) continue;\n"
      + "    if(!g.items || !g.items.length) continue;\n"
      + "    var picked = SBX_R.pickWeighted(g.items);\n"
      + "    if(!picked || !picked.text) continue;\n"
      + "    SBX_R.append(context, 'character.scenario', picked.text);\n"
      + "  }\n"
      + "})();\n";
  }

  function updatePreview(rootEl) {
    var ta = $('#amb-preview', rootEl);
    if (!ta) return;
    try {
      var blocks = getExportBlocks(root.StudioState) || [];
      var code = (blocks[0] && blocks[0].code) ? String(blocks[0].code) : '';
      if (!code) {
        ta.value = '/* Ambient module has no enabled rules. */';
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
    var data = loadData();
    ensureActiveGroup(data);

    buildShell(el);
    renderAll(el, data);

    var btnGA = $('#amb-g-add', el);
    var btnGD = $('#amb-g-dup', el);
    var btnGX = $('#amb-g-del', el);

    if (btnGA) btnGA.onclick = function () { addGroup(data); renderAll(el, data); };
    if (btnGD) btnGD.onclick = function () { dupGroup(data); renderAll(el, data); };
    if (btnGX) btnGX.onclick = function () { delGroup(data); renderAll(el, data); };

    // Copy preview
    var copyBtn = $('#amb-copy', el);
    if (copyBtn) copyBtn.onclick = function () {
      var ta = $('#amb-preview', el);
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

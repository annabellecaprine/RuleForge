/* random.panel.js — Random Groups (ES5)
 * - Groups: left tabs
 * - Items: right sub-tabs, nameable + weights locked to 100 among enabled
 * - Group chance % per turn, weighted item pick
 * - Write target per group: Personality OR Scenario
 * - Bottom preview: paste-ready JanitorAI ES5 snippet (context.character.*)
 */
(function (root) {
  'use strict';

  var PANEL_ID = 'random';
  var STORE_KEY = 'studio.data.random';

  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return (el || document).querySelectorAll(sel); }

  function escHtml(s) {
    s = (s == null ? '' : String(s));
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function uid(prefix) {
    return (prefix || 'r') + Math.random().toString(16).slice(2) + Date.now().toString(16);
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

  // Resolve write target id -> context path
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

  // ---------------------------
  // State
  // ---------------------------
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

  function getGroupById(d, id) {
    for (var i = 0; i < d.groups.length; i++) {
      if (d.groups[i] && d.groups[i].id === id) return d.groups[i];
    }
    return null;
  }

  function getItemById(g, id) {
    for (var i = 0; i < g.items.length; i++) {
      if (g.items[i] && g.items[i].id === id) return g.items[i];
    }
    return null;
  }

  function ensureActiveGroup(d) {
    if (d.ui && d.ui.activeGroupId && getGroupById(d, d.ui.activeGroupId)) return;
    d.ui = d.ui || {};
    d.ui.activeGroupId = (d.groups[0] && d.groups[0].id) ? d.groups[0].id : null;
  }

  function ensureActiveItem(g) {
    g.ui = g.ui || {};
    if (g.ui.activeItemId && getItemById(g, g.ui.activeItemId)) return;
    g.ui.activeItemId = (g.items[0] && g.items[0].id) ? g.items[0].id : null;
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
      if (!g.name) g.name = 'Random Group';
      if (g.triggerChancePct == null) g.triggerChancePct = 15;
      g.triggerChancePct = clampInt(g.triggerChancePct, 0, 100);

      if (!g.writeTargetId) g.writeTargetId = 'character.personality';
      if (g.writeTargetId !== 'character.personality' && g.writeTargetId !== 'character.scenario') {
        g.writeTargetId = 'character.personality';
      }

      g.items = g.items || [];
      g.ui = g.ui || { activeItemId: null };

      for (var j = 0; j < g.items.length; j++) {
        var it = g.items[j];
        if (!it) continue;
        if (!it.id) it.id = uid('i');
        if (typeof it.enabled !== 'boolean') it.enabled = true;
        if (it.weightPct == null) it.weightPct = 0;
        it.weightPct = clampInt(it.weightPct, 0, 100);
        if (it.name == null) it.name = '';
        if (it.text == null) it.text = '';
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

  function normalizeWeights(g, changedId) {
    var items = g && g.items ? g.items : [];
    var enabled = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].enabled !== false) enabled.push(items[i]);
    }
    if (!enabled.length) return;

    var changed = null;
    if (changedId) changed = getItemById(g, changedId);

    if (!changed || changed.enabled === false) {
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

      var acc = 0;
      for (i = 0; i < enabled.length; i++) {
        var w = clampInt(enabled[i].weightPct, 0, 100);
        var scaled = Math.floor((w / total0) * 100);
        enabled[i].weightPct = scaled;
        acc += scaled;
      }
      enabled[enabled.length - 1].weightPct += (100 - acc);
      return;
    }

    changed.weightPct = clampInt(changed.weightPct, 0, 100);
    var remaining = 100 - changed.weightPct;
    if (remaining < 0) remaining = 0;

    var others = [];
    var sum = 0;
    for (i = 0; i < enabled.length; i++) {
      if (enabled[i].id === changed.id) continue;
      others.push(enabled[i]);
      sum += clampInt(enabled[i].weightPct, 0, 100);
    }
    if (!others.length) { changed.weightPct = 100; return; }

    if (sum <= 0) {
      var base2 = Math.floor(remaining / others.length);
      var rem2 = remaining - (base2 * others.length);
      for (i = 0; i < others.length; i++) {
        others[i].weightPct = base2 + (i === others.length - 1 ? rem2 : 0);
      }
      return;
    }

    var acc2 = 0;
    for (i = 0; i < others.length; i++) {
      var w2 = clampInt(others[i].weightPct, 0, 100);
      var scaled2 = Math.floor((w2 / sum) * remaining);
      others[i].weightPct = scaled2;
      acc2 += scaled2;
    }
    others[others.length - 1].weightPct += (remaining - acc2);
  }

  function itemLabel(it, idx) {
    var nm = it && it.name ? trim(it.name) : '';
    return nm ? nm : ('Item ' + (idx + 1));
  }

  // ---------------------------
  // UI helpers: patch tab labels without re-rendering editor
  // ---------------------------
  function patchGroupTabLabel(rootEl, groupId, newName) {
    var host = $('#rnd-groups', rootEl);
    if (!host) return;
    var btn = host.querySelector('[data-id="' + groupId + '"]');
    if (!btn) return;
    var nameEl = btn.querySelector('.lb-tab-name');
    if (nameEl) nameEl.textContent = newName || 'Random Group';
  }

  function patchItemTabLabel(rootEl, itemId, newName) {
    var host = $('#rnd-items', rootEl);
    if (!host) return;
    var btn = host.querySelector('[data-item="' + itemId + '"]');
    if (!btn) return;
    var nameEl = btn.querySelector('.lb-tab-name');
    if (nameEl) nameEl.textContent = newName || 'Item';
  }

  // ---------------------------
  // UI
  // ---------------------------
  function buildShell(el) {
    el.innerHTML =
      '<div class="lb-shell">' +
      '<div class="lb-body">' +
      '<div class="lb-tabs eng-block">' +
      '<div class="eng-h">Random Groups</div>' +
      '<div class="lb-tablist" id="rnd-groups"></div>' +
      '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn" id="rnd-g-add" type="button">Add Group</button>' +
      '<button class="btn btn-ghost" id="rnd-g-dup" type="button">Duplicate</button>' +
      '<button class="btn btn-danger" id="rnd-g-del" type="button">Delete</button>' +
      '</div>' +
      '</div>' +
      '<div class="lb-editor eng-block" id="rnd-editor"></div>' +
      '</div>' +

      // Full-span preview
      '<div class="eng-block" id="rnd-preview-wrap" style="margin-top:14px; width:100%;">' +
      '<div class="lb-editor-head" style="margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">' +
      '<div class="eng-h" style="margin:0;">Generated Script (Random module)</div>' +
      '<div class="lb-editor-actions" style="display:flex; gap:8px; align-items:center;">' +
      '<button class="btn btn-ghost lb-mini" type="button" id="rnd-copy">Copy</button>' +
      '</div>' +
      '</div>' +
      '<div class="eng-muted" style="font-size:12px; margin-bottom:8px;">' +
      'Paste-ready ES5 snippet. Writes to <code>context.character.personality</code> / <code>context.character.scenario</code>.' +
      '</div>' +
      '<textarea id="rnd-preview" readonly spellcheck="false" ' +
      'style="width:100%; min-height:320px; resize:vertical; box-sizing:border-box; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></textarea>' +
      '</div>' +

      '</div>';
  }

  function renderGroups(rootEl, d) {
    var host = $('#rnd-groups', rootEl);
    if (!host) return;

    if (!d.groups.length) {
      host.innerHTML = '<div class="eng-muted" style="margin-bottom:12px;">(no groups yet)</div>' +
        '<button class="btn btn-primary" type="button" id="rnd-g-add-empty">+ Add Your First Group</button>';
      var btnAddEmpty = $('#rnd-g-add-empty', host);
      if (btnAddEmpty) btnAddEmpty.onclick = function () {
        var btnAddOriginal = $('#rnd-g-add', rootEl);
        if (btnAddOriginal) btnAddOriginal.click();
      };
      return;
    }

    var html = '';
    var active = d.ui.activeGroupId;

    for (var i = 0; i < d.groups.length; i++) {
      var g = d.groups[i];
      if (!g) continue;

      var on = (g.enabled !== false);
      var pct = clampInt(g.triggerChancePct, 0, 100);
      var tgt = (g.writeTargetId === 'character.scenario') ? 'Scenario' : 'Personality';

      var preview = '';
      var items = g.items || [];
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (!it || it.enabled === false) continue;
        if (!nonEmpty(it.text)) continue;
        preview = String(it.text);
        break;
      }
      if (preview.length > 48) preview = preview.slice(0, 48) + '…';

      html += ''
        + '<button class="lb-tab' + (g.id === active ? ' is-active' : '') + '" type="button" data-id="' + escHtml(g.id) + '">'
        + '<div class="lb-tab-top">'
        + '<span class="lb-dot ' + (on ? 'on' : 'off') + '" title="' + (on ? 'Enabled' : 'Disabled') + '"></span>'
        + '<span class="lb-tab-name">' + escHtml(g.name || 'Random Group') + '</span>'
        + '</div>'
        + '<div class="lb-tab-meta">'
        + '<span class="lb-meta">' + escHtml(pct + '%') + '</span>'
        + '<span class="lb-meta" style="margin-left:6px;">' + escHtml(tgt) + '</span>'
        + '</div>'
        + (preview ? '<div class="lb-tab-bottom"><span class="lb-meta">' + escHtml(preview) + '</span></div>' : '<div class="lb-tab-bottom"><span class="lb-meta">(empty)</span></div>')
        + '</button>';
    }

    host.innerHTML = html;

    var tabs = $all('#rnd-groups .lb-tab', rootEl);
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].onclick = function () {
        var id = this.getAttribute('data-id');
        d.ui.activeGroupId = id;
        saveData();
        renderAll(rootEl, d);
        updatePreview(rootEl);
      };
    }
  }

  function renderEditor(rootEl, d) {
    var host = $('#rnd-editor', rootEl);
    if (!host) return;

    ensureActiveGroup(d);
    var g = d.ui.activeGroupId ? getGroupById(d, d.ui.activeGroupId) : null;
    if (!g) {
      host.innerHTML = '<div class="eng-muted" style="padding:12px;">Add a group to begin.</div>';
      return;
    }

    g.items = g.items || [];
    g.ui = g.ui || { activeItemId: null };
    ensureActiveItem(g);
    normalizeWeights(g, null);

    var items = g.items || [];
    var tabs = '';
    if (!items.length) {
      tabs = '<div class="eng-muted" style="margin-bottom:12px;">(no items yet)</div>' +
        '<button class="btn btn-primary" type="button" id="rnd-i-add-empty">+ Add Your First Item</button>';
    } else {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        var on = (it.enabled !== false);
        tabs += ''
          + '<button class="lb-tab' + (it.id === g.ui.activeItemId ? ' is-active' : '') + '" type="button" data-item="' + escHtml(it.id) + '">'
          + '<div class="lb-tab-top">'
          + '<span class="lb-dot ' + (on ? 'on' : 'off') + '" title="' + (on ? 'Enabled' : 'Disabled') + '"></span>'
          + '<span class="lb-tab-name">' + escHtml(itemLabel(it, i)) + '</span>'
          + '</div>'
          + '<div class="lb-tab-meta"><span class="lb-meta">' + escHtml(String(clampInt(it.weightPct, 0, 100)) + '%') + '</span></div>'
          + '</button>';
      }
    }

    var itA = g.ui.activeItemId ? getItemById(g, g.ui.activeItemId) : null;
    if (!itA && items[0]) { itA = items[0]; g.ui.activeItemId = itA.id; }

    var sum = 0;
    for (var s = 0; s < items.length; s++) {
      if (items[s] && items[s].enabled !== false) sum += clampInt(items[s].weightPct, 0, 100);
    }

    host.innerHTML =
      '<div class="lb-editor-head">' +
      '<div class="eng-h" style="margin:0;">Random — ' + escHtml(g.name || 'Random Group') + '</div>' +
      '<div class="lb-editor-actions">' +
      '<label class="pill pill-ok"><input id="rnd-g-enabled" type="checkbox" ' + ((g.enabled !== false) ? 'checked' : '') + '> Enabled</label>' +
      '</div>' +
      '</div>' +

      '<div style="margin-top:12px;">' +
      '<div class="card" style="padding:12px;">' +
      '<div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">' +
      '<label class="ctl">Group name <input id="rnd-g-name" type="text" value="' + escHtml(g.name || '') + '" style="min-width:260px;"></label>' +
      '<label class="ctl">Trigger chance (%) <input id="rnd-g-chance" type="number" min="0" max="100" step="1" value="' + escHtml(g.triggerChancePct) + '" style="width:120px;"></label>' +
      '<label class="ctl">Write target ' +
      '<select id="rnd-g-target">' +
      '<option value="character.personality"' + (g.writeTargetId === 'character.personality' ? ' selected' : '') + '>Personality</option>' +
      '<option value="character.scenario"' + (g.writeTargetId === 'character.scenario' ? ' selected' : '') + '>Scenario</option>' +
      '</select>' +
      '</label>' +
      '</div>' +
      '<div class="eng-muted" style="font-size:12px;margin-top:6px;">Rolls each turn. If it hits, an item is chosen by weight and appended. Repeat freely.</div>' +
      '</div>' +
      '</div>' +

      '<div style="margin-top:12px;" class="card">' +
      '<div style="padding:12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">' +
      '<div style="font-weight:900;">Items (weights locked to 100%)</div>' +
      '<div class="eng-muted" style="font-size:12px;">Enabled sum: ' + escHtml(sum + '%') + '</div>' +
      '</div>' +

      '<div class="rnd-split">' +
      '<div class="rnd-items">' +
      '<div class="lb-tablist" id="rnd-items">' + tabs + '</div>' +
      '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button class="btn" id="rnd-i-add" type="button">Add Item</button>' +
      '<button class="btn btn-ghost" id="rnd-i-dup" type="button">Duplicate</button>' +
      '<button class="btn btn-danger" id="rnd-i-del" type="button">Delete</button>' +
      '</div>' +
      '</div>' +

      '<div class="rnd-item-editor">' +
      (itA ? (
        '<div class="lb-editor-head" style="padding:0;margin-bottom:10px;">' +
        '<div class="eng-h" style="margin:0;">Item</div>' +
        '<div class="lb-editor-actions">' +
        '<label class="pill pill-ok"><input id="rnd-i-enabled" type="checkbox" ' + ((itA.enabled !== false) ? 'checked' : '') + '> Enabled</label>' +
        '</div>' +
        '</div>' +

        '<div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">' +
        '<label class="ctl">Name <input id="rnd-i-name" type="text" value="' + escHtml(itA.name || '') + '" style="min-width:240px;"></label>' +
        '<label class="ctl">Weight (%) <input id="rnd-i-weight" type="number" min="0" max="100" step="1" value="' + escHtml(itA.weightPct) + '" style="width:120px;"></label>' +
        '</div>' +
        '<div class="eng-muted" style="font-size:12px;margin-top:6px;">Changing weight auto-balances other enabled items to keep total = 100.</div>' +
        '<div style="margin-top:10px;">' +
        '<label style="display:block;font-weight:600;">Random text</label>' +
        '<textarea id="rnd-i-text" style="width:100%;min-height:140px;resize:vertical;" placeholder="Add text to append...">' + escHtml(itA.text || '') + '</textarea>' +
        '</div>'
      ) : '<div class="eng-muted" style="padding:12px; margin-bottom:12px;">Add an item to begin.</div>') +
      '</div>' +
      '</div>' +
      '</div>';

    // Group controls
    $('#rnd-g-enabled', host).onchange = function () {
      g.enabled = !!this.checked;
      saveData();
      renderGroups(rootEl, d);
      updatePreview(rootEl);
    };

    // do NOT rerender editor on each keypress (focus loss)
    $('#rnd-g-name', host).oninput = function () {
      g.name = this.value;
      saveData();
      patchGroupTabLabel(rootEl, g.id, g.name || 'Random Group');
      updatePreview(rootEl);
    };

    $('#rnd-g-chance', host).oninput = function () {
      g.triggerChancePct = clampInt(this.value, 0, 100);
      saveData();
      renderGroups(rootEl, d);
      updatePreview(rootEl);
    };

    $('#rnd-g-target', host).onchange = function () {
      var v = this.value || 'character.personality';
      if (v !== 'character.personality' && v !== 'character.scenario') v = 'character.personality';
      g.writeTargetId = v;
      saveData();
      renderGroups(rootEl, d);
      updatePreview(rootEl);
    };

    // Item tabs
    var itemTabEls = $all('#rnd-items .lb-tab', host);
    for (var tt = 0; tt < itemTabEls.length; tt++) {
      itemTabEls[tt].onclick = function () {
        var id = this.getAttribute('data-item');
        g.ui.activeItemId = id;
        saveData();
        renderEditor(rootEl, d);
        updatePreview(rootEl);
      };
    }

    // Item toolbar
    $('#rnd-i-add', host).onclick = function () {
      var it = { id: uid('i'), enabled: true, weightPct: 0, text: '', name: '' };
      g.items.push(it);
      g.ui.activeItemId = it.id;
      normalizeWeights(g, null);
      saveData();
      renderEditor(rootEl, d);
      updatePreview(rootEl);
    };

    var btnAddEmptyI = $('#rnd-i-add-empty', host);
    if (btnAddEmptyI) btnAddEmptyI.onclick = function () {
      $('#rnd-i-add', host).click();
    };

    $('#rnd-i-dup', host).onclick = function () {
      var src = g.ui.activeItemId ? getItemById(g, g.ui.activeItemId) : null;
      if (!src) return;
      var c = clone(src);
      c.id = uid('i');
      g.items.push(c);
      g.ui.activeItemId = c.id;
      normalizeWeights(g, null);
      saveData();
      renderEditor(rootEl, d);
      updatePreview(rootEl);
    };

    $('#rnd-i-del', host).onclick = function () {
      var id2 = g.ui.activeItemId;
      if (!id2) return;
      if (!confirm('Delete this item?')) return;

      var idx = -1;
      for (var k = 0; k < g.items.length; k++) {
        if (g.items[k] && g.items[k].id === id2) { idx = k; break; }
      }
      if (idx < 0) return;

      g.items.splice(idx, 1);
      ensureActiveItem(g);
      normalizeWeights(g, null);
      saveData();
      renderEditor(rootEl, d);
      updatePreview(rootEl);
    };

    // Item editor controls
    if (itA) {
      $('#rnd-i-enabled', host).onchange = function () {
        itA.enabled = !!this.checked;
        normalizeWeights(g, itA.id);
        saveData();
        renderEditor(rootEl, d);
        updatePreview(rootEl);
      };

      $('#rnd-i-name', host).oninput = function () {
        itA.name = this.value;
        saveData();
        patchItemTabLabel(rootEl, itA.id, itA.name || 'Item');
        updatePreview(rootEl);
      };

      $('#rnd-i-weight', host).oninput = function () {
        itA.weightPct = clampInt(this.value, 0, 100);
        normalizeWeights(g, itA.id);
        saveData();
        renderEditor(rootEl, d); // weights affect others
        updatePreview(rootEl);
      };

      $('#rnd-i-text', host).oninput = function () {
        itA.text = this.value;
        saveData();
        renderGroups(rootEl, d);
        updatePreview(rootEl);
      };
    }
  }

  function renderAll(rootEl, d) {
    renderGroups(rootEl, d);
    renderEditor(rootEl, d);
  }

  // ---------------------------
  // Group ops
  // ---------------------------
  function addGroup(d) {
    var g = {
      id: uid('g'),
      enabled: true,
      name: 'Random Group',
      triggerChancePct: 15,
      writeTargetId: 'character.personality',
      items: [{ id: uid('i'), enabled: true, weightPct: 100, name: '', text: '' }],
      ui: { activeItemId: null }
    };
    ensureActiveItem(g);
    d.groups.unshift(g);
    d.ui.activeGroupId = g.id;
    saveData();
  }

  function dupGroup(d) {
    ensureActiveGroup(d);
    var src = d.ui.activeGroupId ? getGroupById(d, d.ui.activeGroupId) : null;
    if (!src) return;

    var c = clone(src);
    c.id = uid('g');
    c.name = (c.name || 'Random Group') + ' (Copy)';
    c.items = c.items || [];
    for (var i = 0; i < c.items.length; i++) {
      if (c.items[i]) c.items[i].id = uid('i');
    }
    ensureActiveItem(c);
    normalizeWeights(c, null);
    d.groups.unshift(c);
    d.ui.activeGroupId = c.id;
    saveData();
  }

  function delGroup(d) {
    ensureActiveGroup(d);
    var id = d.ui.activeGroupId;
    if (!id) return;
    if (!confirm('Delete this random group?')) return;

    var idx = -1;
    for (var i = 0; i < d.groups.length; i++) {
      if (d.groups[i] && d.groups[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;

    d.groups.splice(idx, 1);
    ensureActiveGroup(d);
    saveData();
  }

  // ---------------------------
  // Engine hooks
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
      for (var j = 0; j < (g.items || []).length; j++) {
        var it = g.items[j];
        if (!it || it.enabled === false) continue;
        if (!nonEmpty(it.text)) continue;
        var w = clampInt(it.weightPct, 0, 100);
        if (w <= 0) continue;
        items.push({ pct: w, text: String(it.text || '') });
      }
      if (!items.length) continue;

      out.push({
        id: 'random:group:' + g.id,
        moduleId: PANEL_ID,
        enabled: true,
        label: 'Random — ' + (g.name || 'Group'),
        pct: pct,
        target: resolveWritePath(g.writeTargetId || 'character.personality'),
        items: items
      });
    }
    return out;
  }

  function getWriteTargets() {
    return ['context.character.personality', 'context.character.scenario'];
  }

  function getExportBlocks(studioState) {
    var rules = getRuleSpecs(studioState);
    return [{
      kind: 'script',
      id: 'random.module',
      code: emitES5(rules)
    }];
  }

  function emitES5(rules) {
    if (!rules || !rules.length) return '';
    var json = JSON.stringify(rules);

    return ''
      + "(function(){\n"
      + "  'use strict';\n"
      + "  var RULES = " + json + ";\n"
      + "\n"
      + "  function get(obj, path){\n"
      + "    var parts = String(path||'').split('.');\n"
      + "    var cur = obj;\n"
      + "    for (var i=0;i<parts.length;i++){\n"
      + "      if (!cur) return undefined;\n"
      + "      cur = cur[parts[i]];\n"
      + "    }\n"
      + "    return cur;\n"
      + "  }\n"
      + "  function set(obj, path, val){\n"
      + "    var parts = String(path||'').split('.');\n"
      + "    var cur = obj;\n"
      + "    for (var i=0;i<parts.length-1;i++){\n"
      + "      var k = parts[i];\n"
      + "      if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};\n"
      + "      cur = cur[k];\n"
      + "    }\n"
      + "    cur[parts[parts.length-1]] = val;\n"
      + "  }\n"
      + "  function rollChance(pct){\n"
      + "    pct = parseInt(pct, 10);\n"
      + "    if (isNaN(pct) || pct <= 0) return false;\n"
      + "    if (pct >= 100) return true;\n"
      + "    return (Math.random() * 100) < pct;\n"
      + "  }\n"
      + "  function pickWeighted(items){\n"
      + "    var total = 0;\n"
      + "    for (var i=0;i<items.length;i++) total += (items[i].pct||0);\n"
      + "    if (total <= 0) return null;\n"
      + "    var r = Math.random() * total;\n"
      + "    var acc = 0;\n"
      + "    for (i=0;i<items.length;i++){\n"
      + "      acc += (items[i].pct||0);\n"
      + "      if (r < acc) return items[i];\n"
      + "    }\n"
      + "    return items[items.length-1] || null;\n"
      + "  }\n"
      + "  function appendText(targetPath, text){\n"
      + "    if (!text) return;\n"
      + "    var keyPath = String(targetPath).replace(/^context\\./,'');\n"
      + "    var box = { context: context };\n"
      + "    var cur = get(box, keyPath);\n"
      + "    cur = (cur == null) ? '' : String(cur);\n"
      + "    var add = String(text);\n"
      + "    var next = cur;\n"
      + "    if (next && next.length) next += '\\n' + add;\n"
      + "    else next += add;\n"
      + "    set(box, keyPath, next);\n"
      + "  }\n"
      + "\n"
      + "  for (var gi=0; gi<RULES.length; gi++){\n"
      + "    var g = RULES[gi];\n"
      + "    if (!g || !g.items || !g.items.length) continue;\n"
      + "    if (!rollChance(g.pct)) continue;\n"
      + "    var picked = pickWeighted(g.items);\n"
      + "    if (!picked) continue;\n"
      + "    appendText(g.target, picked.text);\n"
      + "  }\n"
      + "})();\n";
  }

  function updatePreview(rootEl) {
    var ta = $('#rnd-preview', rootEl);
    if (!ta) return;
    try {
      var blocks = getExportBlocks(root.StudioState) || [];
      var code = (blocks[0] && blocks[0].code) ? String(blocks[0].code) : '';
      if (!code) {
        ta.value = '/* Random module has no enabled rules. */';
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
  function mount(rootEl /*, studioState */) {
    var d = loadData();
    buildShell(rootEl);
    renderAll(rootEl, d);
    updatePreview(rootEl);

    // Group toolbar
    var btnAdd = $('#rnd-g-add', rootEl);
    var btnDup = $('#rnd-g-dup', rootEl);
    var btnDel = $('#rnd-g-del', rootEl);

    if (btnAdd) btnAdd.onclick = function () { addGroup(d); renderAll(rootEl, d); updatePreview(rootEl); };
    if (btnDup) btnDup.onclick = function () { dupGroup(d); renderAll(rootEl, d); updatePreview(rootEl); };
    if (btnDel) btnDel.onclick = function () { delGroup(d); renderAll(rootEl, d); updatePreview(rootEl); };

    // Copy preview
    var copyBtn = $('#rnd-copy', rootEl);
    if (copyBtn) copyBtn.onclick = function () {
      var ta = $('#rnd-preview', rootEl);
      if (!ta) return;
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (_e) { }
    };
  }

  if (!root.Panels || !root.Panels.register) {
    throw new Error('random.panel.js requires panels.registry.js loaded first');
  }

  // Primary ID (matches index.html data-panel="random")
  var def = {
    id: PANEL_ID,
    mount: mount,
    getRuleSpecs: getRuleSpecs,
    getWriteTargets: getWriteTargets,
    getExportBlocks: getExportBlocks
  };
  root.Panels.register(def);

  // Alias ID (if engine/UI expects "randomEvents" somewhere)
  root.Panels.register({
    id: 'randomEvents',
    mount: def.mount,
    getRuleSpecs: def.getRuleSpecs,
    getWriteTargets: def.getWriteTargets,
    getExportBlocks: def.getExportBlocks
  });

})(window);

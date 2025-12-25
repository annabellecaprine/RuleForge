(function (root) {
  'use strict';

  var SBX = (root.SBX = root.SBX || {});
  SBX.pages = SBX.pages || {};
  SBX.pages.module = SBX.pages.module || {};

  var dom = SBX.dom;
  var store = SBX.store;

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function esc(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid(prefix) {
    prefix = String(prefix || 'u');
    if (SBX.Model && typeof SBX.Model.uid === 'function') {
      return SBX.Model.uid(prefix);
    }
    return prefix + '_' + Math.random().toString(36).slice(2, 8);
  }

  function clone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (_e) { }
    return obj;
  }

  function ensureStore() {
    if (!store || typeof store.ensureStudioState !== 'function') {
      root.StudioState = root.StudioState || {};
      root.StudioState.data = root.StudioState.data || {};
      return {
        get: function () { return root.StudioState; },
        set: function (x) { root.StudioState = x; },
        ensureStudioState: function () { return root.StudioState; }
      };
    }
    return store;
  }

  function getStudioState() {
    var s = ensureStore();
    return s.ensureStudioState ? s.ensureStudioState() : (s.get ? s.get() : {});
  }

  function saveStudioState(studioState) {
    var s = ensureStore();
    if (s.set) s.set(studioState);
    if (s.save) s.save(studioState);
  }

  function loadData() {
    var st = getStudioState();
    st.data = st.data || {};
    st.data.sbx = st.data.sbx || {};
    st.data.sbx.modules = st.data.sbx.modules || {};
    st.data.sbx.moduleOrder = st.data.sbx.moduleOrder || [];
    st.data.sbx.lists = isArr(st.data.sbx.lists) ? st.data.sbx.lists : [];
    return st.data.sbx;
  }

  function saveData() {
    var st = getStudioState();
    st.data = st.data || {};
    st.data.sbx = st.data.sbx || {};
    saveStudioState(st);
  }

  // ---------- Global list helpers ----------

  function listOptionsHtml(sbxData, selectedId) {
    selectedId = String(selectedId || '');
    var lists = sbxData.lists || [];
    var html = '<option value="">(select list)</option>';
    var i;
    for (i = 0; i < lists.length; i++) {
      var L = lists[i] || {};
      var id = String(L.id || '');
      if (!id) continue;
      var lbl = String(L.label || id);
      html += '<option value="' + esc(id) + '"' + (id === selectedId ? ' selected' : '') + '>' + esc(lbl) + '</option>';
    }
    return html;
  }

  function derivedOptionsHtml(mod, selectedKey) {
    selectedKey = String(selectedKey || '');
    var dArr = (mod && mod.appState && isArr(mod.appState.derived)) ? mod.appState.derived : [];
    var html = '<option value="">-- choose derived --</option>';
    var i;
    for (i = 0; i < dArr.length; i++) {
      var d = dArr[i] || {};
      var key = String(d.key || '');
      if (!key) continue;
      var label = key;
      if (d.description) label += ' (' + d.description + ')';
      html += '<option value="' + esc(key) + '"' + (key === selectedKey ? ' selected' : '') + '>' + esc(label) + '</option>';
    }
    return html;
  }

  // ---------- Condition / Node helpers ----------

  function makeEmptyCond() {
    return {
      nodeType: 'cond',
      nid: uid('n'),
      type: 'anyInList',
      listId: '',
      source: 'normLastUserMsg',
      op: '>=',
      threshold: 1,
      windowSize: 8,
      memKey: '',
      textContains: '',
      derivedKey: ''
    };
  }

  function makeEmptyGroup(join) {
    return {
      nodeType: 'group',
      nid: uid('n'),
      join: String(join || 'and').toLowerCase(),
      children: []
    };
  }

  function makeEmptyAction() {
    return {
      target: 'context.character.personality',
      mode: 'append',
      memKey: '',
      text: '',
      label: ''
    };
  }

  function ensureModule(sbxData, moduleId, meta) {
    sbxData = sbxData || {};
    sbxData.modules = sbxData.modules || {};
    sbxData.moduleOrder = sbxData.moduleOrder || [];
    sbxData.lists = isArr(sbxData.lists) ? sbxData.lists : [];

    if (!sbxData.modules[moduleId]) {
      sbxData.modules[moduleId] = {
        id: moduleId,
        label: meta && meta.label ? meta.label : moduleId,
        description: '',
        ui: {},
        appState: { lists: [], derived: [], blocks: [] }
      };
      sbxData.moduleOrder.push(moduleId);
    }

    var mod = sbxData.modules[moduleId];
    mod.ui = mod.ui || {};
    mod.appState = mod.appState || { lists: [], derived: [], blocks: [] };
    mod.appState.lists = isArr(mod.appState.lists) ? mod.appState.lists : [];
    mod.appState.blocks = isArr(mod.appState.blocks) ? mod.appState.blocks : [];
    mod.appState.derived = isArr(mod.appState.derived) ? mod.appState.derived : [];

    // Legacy compatibility: some earlier prototypes stored lists per-module;
    // global lists now live in sbxData.lists, but we keep module.appState.lists
    // as a soft "favorite lists" view if needed later.

    return mod;
  }

  function deleteListGlobal(sbxData, listId) {
    listId = String(listId || '');
    if (!listId) return;

    // Remove from global pool
    var lists = sbxData.lists || [];
    var next = [];
    var i;
    for (i = 0; i < lists.length; i++) {
      var L = lists[i];
      if (!L) continue;
      if (String(L.id || '') === listId) continue;
      next.push(L);
    }
    sbxData.lists = next;

    // Scrub all blocks in all modules that reference this list (in nested trees)
    if (!sbxData.modules) return;
    function scrubNode(node) {
      if (!node || typeof node !== 'object') return;
      if (node.nodeType === 'cond') {
        if (String(node.listId || '') === listId) node.listId = '';
      } else if (node.nodeType === 'group' && isArr(node.children)) {
        var j;
        for (j = 0; j < node.children.length; j++) scrubNode(node.children[j]);
      }
    }

    var mid;
    for (mid in sbxData.modules) {
      if (!sbxData.modules.hasOwnProperty(mid)) continue;
      var mod = sbxData.modules[mid];
      if (!mod || !mod.appState || !isArr(mod.appState.blocks)) continue;
      var blocks = mod.appState.blocks;
      for (i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (!b || !isArr(b.conditions)) continue;
        var k;
        for (k = 0; k < b.conditions.length; k++) scrubNode(b.conditions[k]);
      }
    }
  }

  // Flatten group tree for display / manipulation
  function cloneNode(node) { return clone(node); }

  function ensureNodeIdsForBlocks(blocks) {
    blocks = isArr(blocks) ? blocks : [];
    var counter = 0;
    function ensureNodeId(node) {
      if (!node || typeof node !== 'object') return;
      if (!node.nid) {
        node.nid = 'n' + (counter++);
      }
      if (node.nodeType === 'group' && isArr(node.children)) {
        var i;
        for (i = 0; i < node.children.length; i++) ensureNodeId(node.children[i]);
      }
    }
    var i;
    for (i = 0; i < blocks.length; i++) {
      var b = blocks[i] || {};
      var j;
      if (isArr(b.conditions)) {
        for (j = 0; j < b.conditions.length; j++) ensureNodeId(b.conditions[j]);
      }
    }
  }

  // Compute IF / ELSEIF / ELSE chains
  function computeChains(blocks) {
    blocks = isArr(blocks) ? blocks : [];
    var out = [];
    var i = 0;
    while (i < blocks.length) {
      var b = blocks[i] || {};
      var type = String(b.type || 'if').toLowerCase();
      if (type !== 'if') { i++; continue; }

      var start = i;
      var end = i;
      i++;
      while (i < blocks.length) {
        var nb = blocks[i] || {};
        var t2 = String(nb.type || '').toLowerCase();
        if (t2 !== 'elseif' && t2 !== 'else') break;
        end = i;
        i++;
      }
      out.push({ start: start, end: end });
    }
    return out;
  }

  function renderCondDetailsHTML(cond, sbxData, mod) {
    var type = String(cond.type || 'anyInList');
    var html = '';

    if (type === 'anyInList' || type === 'noneInList') {
      html += '<label class="inline">Search from: ' +
        '<select class="inp condListSelect">' +
        listOptionsHtml(sbxData, cond.listId) +
        '</select>' +
        '</label>' +
        '<label class="inline" style="margin-left:6px;">Source: ' +
        '<select class="inp condSourceSelect">' +
        '<option value="normLastUserMsg"' + (cond.source === 'normLastUserMsg' ? ' selected' : '') + '>Last user message (normalized)</option>' +
        '</select>' +
        '</label>';
    } else if (type === 'countInHistory') {
      html += '<label class="inline">Search from: ' +
        '<select class="inp condListSelect">' +
        listOptionsHtml(sbxData, cond.listId) +
        '</select>' +
        '</label>' +
        '<label class="inline" style="margin-left:6px;">Look at last N messages: ' +
        '<input type="number" class="inp condWindowSize" value="' + esc(cond.windowSize || 8) + '" />' +
        '</label>' +
        '<label class="inline" style="margin-left:6px;">Count matches with (>=, >, ==, <=, <): ' +
        '<select class="inp condOp">' +
        '<option value=">="' + (cond.op === '>=' ? ' selected' : '') + '>&gt;=</option>' +
        '<option value=">"' + (cond.op === '>' ? ' selected' : '') + '>&gt;</option>' +
        '<option value="=="' + (cond.op === '==' ? ' selected' : '') + '>==</option>' +
        '<option value="<="' + (cond.op === '<=' ? ' selected' : '') + '>&lt;=</option>' +
        '<option value="<"' + (cond.op === '<' ? ' selected' : '') + '>&lt;</option>' +
        '</select>' +
        '</label>' +
        '<label class="inline" style="margin-left:6px;">Threshold: ' +
        '<input type="number" class="inp condThreshold" value="' + esc(cond.threshold || 1) + '" />' +
        '</label>';
    } else if (type === 'messageCountComparison') {
      html += '<label class="inline">Compare messageCount with (>=, >, ==, <=, <): ' +
        '<select class="inp condOp">' +
        '<option value=">="' + (cond.op === '>=' ? ' selected' : '') + '>&gt;=</option>' +
        '<option value=">"' + (cond.op === '>' ? ' selected' : '') + '>&gt;</option>' +
        '<option value="=="' + (cond.op === '==' ? ' selected' : '') + '>==</option>' +
        '<option value="<="' + (cond.op === '<=' ? ' selected' : '') + '>&lt;=</option>' +
        '<option value="<"' + (cond.op === '<' ? ' selected' : '') + '>&lt;</option>' +
        '</select>' +
        '</label>' +
        '<label class="inline" style="margin-left:6px;">Threshold: ' +
        '<input type="number" class="inp condThreshold" value="' + esc(cond.threshold || 1) + '" />' +
        '</label>';
    } else if (type === 'memoryNumberComparison' || type === 'memoryStringContains') {
      html += '<label class="inline">Memory key: ' +
        '<input type="text" class="inp condMemKey" value="' + esc(cond.memKey || '') + '" placeholder="e.g. affection" />' +
        '</label>';

      if (type === 'memoryNumberComparison') {
        html += '<label class="inline" style="margin-left:6px;">Compare with (>=, >, ==, <=, <): ' +
          '<select class="inp condOp">' +
          '<option value=">="' + (cond.op === '>=' ? ' selected' : '') + '>&gt;=</option>' +
          '<option value=">"' + (cond.op === '>' ? ' selected' : '') + '>&gt;</option>' +
          '<option value="=="' + (cond.op === '==' ? ' selected' : '') + '>==</option>' +
          '<option value="<="' + (cond.op === '<=' ? ' selected' : '') + '>&lt;=</option>' +
          '<option value="<"' + (cond.op === '<' ? ' selected' : '') + '>&lt;</option>' +
          '</select>' +
          '</label>' +
          '<label class="inline" style="margin-left:6px;">Threshold: ' +
          '<input type="number" class="inp condThreshold" value="' + esc(cond.threshold || 1) + '" />' +
          '</label>';
      } else {
        html += '<label class="inline" style="margin-left:6px;">Text contains: ' +
          '<input type="text" class="inp condTextContains" value="' + esc(cond.textContains || '') + '" />' +
          '</label>';
      }
    } else if (type === 'derivedNumberComparison') {
      html += '<label class="inline">Derived key: ' +
        '<select class="inp condDerivedKeySelect">' +
        derivedOptionsHtml(mod, cond.derivedKey) +
        '</select>' +
        '</label>' +
        '<label class="inline" style="margin-left:6px;">Compare with (>=, >, ==, <=, <): ' +
        '<select class="inp condOp">' +
        '<option value=">="' + (cond.op === '>=' ? ' selected' : '') + '>&gt;=</option>' +
        '<option value=">"' + (cond.op === '>' ? ' selected' : '') + '>&gt;</option>' +
        '<option value="=="' + (cond.op === '==' ? ' selected' : '') + '>==</option>' +
        '<option value="<="' + (cond.op === '<=' ? ' selected' : '') + '>&lt;=</option>' +
        '<option value="<"' + (cond.op === '<' ? ' selected' : '') + '>&lt;</option>' +
        '</select>' +
        '</label>' +
        '<label class="inline" style="margin-left:6px;">Threshold: ' +
        '<input type="number" class="inp condThreshold" value="' + esc(cond.threshold || 1) + '" />' +
        '</label>';
    }

    return html;
  }

  function renderCondNodeHTML(node, blockIndex, sbxData, mod) {
    node = node || makeEmptyCond();

    if (!node.nodeType) {
      node.nodeType = 'cond';
    }

    if (node.nodeType === 'group') {
      var join = String(node.join || 'and').toLowerCase();
      var html =
        '<div class="sbxA-card sbxA-condGroup" data-nid="' + esc(node.nid || '') + '">' +
        '<div class="sbxA-row" style="justify-content:space-between; align-items:center;">' +
        '<div>' +
        '<select class="inp groupJoinType">' +
        '<option value="and"' + (join !== 'or' ? ' selected' : '') + '>ALL must be true (AND)</option>' +
        '<option value="or"' + (join === 'or' ? ' selected' : '') + '>ANY can be true (OR)</option>' +
        '</select>' +
        '</div>' +
        '<div>' +
        '<button class="btn btn-ghost" type="button" data-act="addCond">Add Condition</button>' +
        '<button class="btn btn-ghost" type="button" data-act="addGroup">Add Group</button>' +
        '<button class="btn btn-ghost" type="button" data-act="delNode">Delete</button>' +
        '</div>' +
        '</div>' +
        '<div class="blockConditions" data-block-index="' + blockIndex + '">' +
        renderCondArrayHTML(node.children, blockIndex, sbxData, mod) +
        '</div>' +
        '</div>';
      return html;
    }

    var type = String(node.type || 'anyInList');
    var html2 =
      '<div class="sbxA-card sbxA-cond" data-nid="' + esc(node.nid || '') + '">' +
      '<div class="sbxA-row wrap" style="justify-content:space-between; align-items:center;">' +
      '<div>' +
      '<label class="inline">Type: ' +
      '<select class="inp condType">' +
      '<option value="">-- choose --</option>' +
      '<option value="anyInList"' + (type === 'anyInList' ? ' selected' : '') + '>Any in list (last user)</option>' +
      '<option value="noneInList"' + (type === 'noneInList' ? ' selected' : '') + '>None in list (last user)</option>' +
      '<option value="countInHistory"' + (type === 'countInHistory' ? ' selected' : '') + '>Count in history</option>' +
      '<option value="messageCountComparison"' + (type === 'messageCountComparison' ? ' selected' : '') + '>Compare messageCount</option>' +
      '<option value="memoryNumberComparison"' + (type === 'memoryNumberComparison' ? ' selected' : '') + '>Compare memory (number)</option>' +
      '<option value="memoryStringContains"' + (type === 'memoryStringContains' ? ' selected' : '') + '>Memory string contains</option>' +
      '<option value="derivedNumberComparison"' + (type === 'derivedNumberComparison' ? ' selected' : '') + '>Compare derived value (number)</option>' +
      '</select>' +
      '</label>' +
      '</div>' +
      '<div>' +
      '<button class="btn btn-ghost" type="button" data-act="delNode">Delete</button>' +
      '</div>' +
      '</div>' +
      '<div class="condDetails" style="margin-top:4px;">' +
      renderCondDetailsHTML(node, sbxData, mod) +
      '</div>' +
      '</div>';

    return html2;
  }

  function renderCondArrayHTML(nodes, blockIndex, sbxData, mod) {
    nodes = isArr(nodes) ? nodes : [];
    var html = '';
    var i;
    for (i = 0; i < nodes.length; i++) {
      html += renderCondNodeHTML(nodes[i], blockIndex, sbxData, mod);
    }
    return html;
  }

  function findNodeByNid(blocks, blockIndex, nid) {
    blocks = isArr(blocks) ? blocks : [];
    var b = blocks[blockIndex] || {};
    var nodes = isArr(b.conditions) ? b.conditions : (b.conditions = []);

    var found = null;
    function visit(node, parent, idx) {
      if (!node || typeof node !== 'object') return;
      if (String(node.nid || '') === nid) {
        found = { node: node, parent: parent, idx: idx };
        return;
      }
      if (node.nodeType === 'group' && isArr(node.children)) {
        var i;
        for (i = 0; i < node.children.length; i++) {
          visit(node.children[i], node, i);
          if (found) return;
        }
      }
    }

    var i;
    for (i = 0; i < nodes.length; i++) {
      visit(nodes[i], null, i);
      if (found) break;
    }

    return found;
  }

  function render(rootEl, moduleId) {
    moduleId = String(moduleId || '');
    if (!moduleId) moduleId = 'lorebook';

    var sbxData = loadData();
    var mod = ensureModule(sbxData, moduleId, { label: moduleId });
    var app = mod.appState;
    var blocks = app.blocks = isArr(app.blocks) ? app.blocks : [];

    var html =
      '<div class="sbxA-page">' +
      '<div class="sbxA-h2">Advanced: ' + esc(mod.label || moduleId) + '</div>' +
      '<div class="sbxA-muted">Refine what the Basic module do...E IF / ELSE chains, lists, memory, and derived metrics.</div>' +
      '<div class="sbxA-grid2" style="margin-top:12px;">' +
      '<div>' +
      '<div id="sbx-mod-lists"></div>' +
      '<div id="sbx-mod-derived" style="margin-top:12px;"></div>' +
      '</div>' +
      '<div id="sbx-mod-blocks"></div>' +
      '</div>' +
      '</div>';

    rootEl.innerHTML = html;

    var $ = function (sel) { return dom.q(sel, rootEl); };

    function persist() {
      saveData();
    }

    // ----- Lists (GLOBAL) -----
    function renderLists() {
      var host = $('#sbx-mod-lists');
      if (!host) return;

      var lists = sbxData.lists || [];

      var htmlL =
        '<div class="sbxA-h3">Lists</div>' +
        '<div class="sbxA-muted">Lists are shared across ALL Advanced modules. Each line is a keyword or phrase.</div>' +
        '<div class="sbxA-row" style="margin-top:10px;">' +
        '<button class="btn btn-ghost" type="button" id="sbx-list-add">New List</button>' +
        '</div>' +
        '<div id="sbx-list-wrap" style="margin-top:10px; display:flex; flex-direction:column; gap:10px;"></div>';

      host.innerHTML = htmlL;

      var wrap = $('#sbx-list-wrap');
      if (!wrap) return;

      var cards = '';
      var i;
      for (i = 0; i < lists.length; i++) {
        var L = lists[i] || {};
        var items = isArr(L.items) ? L.items.join('\n') : '';
        cards +=
          '<div class="sbxA-card" style="padding:10px;" data-lidx="' + i + '">' +
          '<div class="sbxA-row" style="justify-content:space-between;">' +
          '<div style="flex:1; margin-right:6px;">' +
          '<input class="inp" data-k="label" value="' + esc(L.label || ('List ' + (i + 1))) + '" />' +
          '</div>' +
          '<button class="btn btn-ghost" type="button" data-act="delList">Delete</button>' +
          '</div>' +
          '<div class="sbxA-muted" style="margin-top:6px;">One keyword or phrase per line.</div>' +
          '<textarea class="inp sbxA-ta sbxA-mono" data-k="items" style="margin-top:6px;">' + esc(items) + '</textarea>' +
          '</div>';
      }

      wrap.innerHTML = cards;

      var addBtn = $('#sbx-list-add');
      if (addBtn) {
        addBtn.onclick = function () {
          sbxData.lists = sbxData.lists || [];
          sbxData.lists.push({
            id: uid('lst'),
            label: 'New List',
            description: '',
            items: []
          });
          persist();
          renderLists();
          renderBlocks();
        };
      }

      dom.delegate(wrap, 'click', 'button[data-act="delList"]', function (e, btn) {
        if (e && e.preventDefault) e.preventDefault();
        var card = btn;
        while (card && card.getAttribute && !card.getAttribute('data-lidx')) card = card.parentNode;
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-lidx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= sbxData.lists.length) return;
        var L = sbxData.lists[idx];
        if (!root.confirm || root.confirm('Delete this list? This affects all modules.')) {
          var lid = L && L.id ? String(L.id) : '';
          if (lid) deleteListGlobal(sbxData, lid);
          persist();
          renderLists();
          renderBlocks();
        }
      });

      dom.delegate(wrap, 'input', '.inp', function (_e, input) {
        var card = input;
        while (card && card.getAttribute && !card.getAttribute('data-lidx')) card = card.parentNode;
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-lidx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= sbxData.lists.length) return;
        var L = sbxData.lists[idx] || {};
        var k = input.getAttribute('data-k');
        if (!k) return;

        if (k === 'label') {
          L.label = input.value || '';
        } else if (k === 'items') {
          var raw = String(input.value || '');
          var lines = raw.split(/\r?\n/);
          var out = [];
          var seen = {};
          var j;
          for (j = 0; j < lines.length; j++) {
            var line = String(lines[j] || '');
            line = line.replace(/^\s+|\s+$/g, '');
            if (!line || seen[line]) continue;
            seen[line] = true;
            out.push(line);
          }
          L.items = out;
        }
        sbxData.lists[idx] = L;
        persist();
      });
    }

    // ----- Derived values (per-module) -----
    function renderDerived() {
      var host = $('#sbx-mod-derived');
      if (!host) return;

      var dArr = mod.appState.derived = isArr(mod.appState.derived) ? mod.appState.derived : [];

      var htmlD =
        '<div class="sbxA-h3">Derived values</div>' +
        '<div class="sbxA-muted">Computed counts over normalized history. Referenced by derivedNumberComparison conditions.</div>' +
        '<div class="sbxA-row" style="margin-top:10px;">' +
        '<button class="btn btn-ghost" type="button" id="sbx-derived-add">Add Derived Value</button>' +
        '</div>' +
        '<div id="sbx-derived-wrap" style="margin-top:10px; display:flex; flex-direction:column; gap:10px;"></div>';

      host.innerHTML = htmlD;

      var wrap = $('#sbx-derived-wrap');
      if (!wrap) return;

      var cardsD = '';
      var iD;
      for (iD = 0; iD < dArr.length; iD++) {
        var d = dArr[iD] || {};
        cardsD +=
          '<div class="sbxA-card" style="padding:8px;" data-didx="' + iD + '">' +
          '<div class="sbxA-row wrap" style="align-items:center;">' +
          '<label class="inline">Key: ' +
          '<input type="text" class="inp derivedKeyInput" value="' + esc(d.key || '') + '" placeholder="e.g. affectionCount" />' +
          '</label>' +
          '<label class="inline" style="margin-left:6px;">Description: ' +
          '<input type="text" class="inp derivedDescInput" value="' + esc(d.description || '') + '" placeholder="optional" />' +
          '</label>' +
          '</div>' +
          '<div class="sbxA-row wrap" style="margin-top:6px; align-items:center;">' +
          '<label class="inline">List: ' +
          '<select class="inp derivedListSelect">' +
          listOptionsHtml(sbxData, d.listId) +
          '</select>' +
          '</label>' +
          '<label class="inline" style="margin-left:6px;">Last N messages: ' +
          '<input type="number" class="inp derivedWindowInput" value="' + esc(d.windowSize || 10) + '" />' +
          '</label>' +
          '<button class="btn btn-ghost inline" type="button" data-act="delDerived" style="margin-left:auto;">Delete</button>' +
          '</div>' +
          '</div>';
      }

      wrap.innerHTML = cardsD;

      var addBtnD = $('#sbx-derived-add');
      if (addBtnD) {
        addBtnD.onclick = function () {
          dArr.push({
            key: 'newMetric',
            description: '',
            listId: '',
            windowSize: 10
          });
          persist();
          renderDerived();
          renderBlocks(); // keep dropdowns in sync
        };
      }

      dom.delegate(wrap, 'input', 'input.derivedKeyInput', function (_e, inp) {
        var card = inp;
        while (card && card.getAttribute && !card.getAttribute('data-didx')) card = card.parentNode;
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-didx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= dArr.length) return;
        var d = dArr[idx] || {};
        d.key = inp.value || '';
        dArr[idx] = d;
        persist();
        renderBlocks(); // update derived dropdown labels
      });

      dom.delegate(wrap, 'input', 'input.derivedDescInput', function (_e, inp) {
        var card = inp;
        while (card && card.getAttribute && !card.getAttribute('data-didx')) card = card.parentNode;
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-didx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= dArr.length) return;
        var d = dArr[idx] || {};
        d.description = inp.value || '';
        dArr[idx] = d;
        persist();
      });

      dom.delegate(wrap, 'change', 'select.derivedListSelect', function (_e, sel) {
        var card = sel;
        while (card && card.getAttribute && !card.getAttribute('data-didx')) card = card.parentNode;
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-didx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= dArr.length) return;
        var d = dArr[idx] || {};
        d.listId = sel.value || '';
        dArr[idx] = d;
        persist();
      });

      dom.delegate(wrap, 'input', 'input.derivedWindowInput', function (_e, inp) {
        var card = inp;
        while (card && card.getAttribute && !card.getAttribute('data-didx')) card = card.parentNode;
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-didx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= dArr.length) return;
        var d = dArr[idx] || {};
        var n = parseInt(inp.value, 10);
        d.windowSize = (isNaN(n) || n <= 0) ? 10 : n;
        dArr[idx] = d;
        persist();
      });

      dom.delegate(wrap, 'click', 'button[data-act="delDerived"]', function (_e, btn) {
        var card = btn;
        while (card && card.getAttribute && !card.getAttribute('data-didx')) card = card.parentNode;
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-didx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= dArr.length) return;
        dArr.splice(idx, 1);
        persist();
        renderDerived();
        renderBlocks();
      });
    }

    // ----- Rules/blocks -----
    function renderBlocks() {
      var host = $('#sbx-mod-blocks');
      if (!host) return;

      blocks = app.blocks = isArr(app.blocks) ? app.blocks : [];
      ensureNodeIdsForBlocks(blocks);
      var chains = computeChains(blocks);

      var htmlB =
        '<div class="sbxA-h3">Rules</div>' +
        '<div class="sbxA-muted">Each IF / ELSE IF / ELSE chain ... memory, and derived metrics to build complex triggers.</div>' +
        '<div class="sbxA-row" style="margin-top:10px;">' +
        '<button class="btn btn-ghost" type="button" id="sbx-rule-add">New IF Chain</button>' +
        '<button class="btn btn-ghost" type="button" id="sbx-import-basic">Import from Basic</button>' +
        '</div>' +
        '<div id="sbx-rule-wrap" style="margin-top:10px; display:flex; flex-direction:column; gap:10px;"></div>';

      host.innerHTML = htmlB;

      var wrap = $('#sbx-rule-wrap');
      if (!wrap) return;

      var cards = '';
      var c;
      for (c = 0; c < chains.length; c++) {
        var ch = chains[c];
        cards += '<div class="sbxA-card" style="padding:10px;" data-cidx="' + c + '">';
        cards += '<div class="sbxA-row" style="justify-content:space-between;">' +
          '<div style="font-weight:900;">Rule ' + (c + 1) + '</div>' +
          '<div>' +
          '<button class="btn btn-ghost" type="button" data-act="moveChainUp">Move Up</button>' +
          '<button class="btn btn-ghost" type="button" data-act="moveChainDown">Move Down</button>' +
          '<button class="btn btn-ghost" type="button" data-act="delChain">Delete</button>' +
          '</div>' +
          '</div>';
        cards += '<div style="margin-top:8px;">';

        var bi;
        for (bi = ch.start; bi <= ch.end; bi++) {
          var b = blocks[bi] || {};
          var t = String(b.type || '').toLowerCase();
          var label = (t === 'if') ? 'IF' : (t === 'elseif' ? 'ELSE IF' : 'ELSE');

          if (!b.actions) b.actions = [];
          if (!b.conditions) b.conditions = [];
          if (!b.actions.length) b.actions.push(makeEmptyAction());
          if (t !== 'else' && !b.conditions.length) b.conditions.push(makeEmptyCond());

          var join = String(b.join || 'and').toLowerCase();

          cards += '<div class="sbxA-card" style="margin-top:6px; padding:8px;" data-bidx="' + bi + '">' +
            '<div class="sbxA-row" style="font-size:11px; margin-bottom:4px; align-items:center;">' +
            '<div style="font-weight:900;">' + label + '</div>' +
            '<input type="text" class="inp blockLabelInput" style="margin-left:6px; min-width:120px;" ' +
            'value="' + esc(b.label || '') + '" placeholder="Block label (optional)" />' +
            '</div>';

          // CONDITIONS
          if (t !== 'else') {
            cards += '<div class="sbxA-row wrap" style="margin-bottom:4px;">' +
              '<label class="inline">Combine conditions with: ' +
              '<select class="inp blockJoinType">' +
              '<option value="and"' + (join !== 'or' ? ' selected' : '') + '>ALL must be true (AND)</option>' +
              '<option value="or"' + (join === 'or' ? ' selected' : '') + '>ANY can be true (OR)</option>' +
              '</select>' +
              '</label>' +
              '</div>';
          }

          cards += '<div class="blockConditions">' +
            renderCondArrayHTML(b.conditions, bi, sbxData, mod) +
            '</div>';

          if (t !== 'else') {
            cards += '<div class="sbxA-row" style="margin-top:6px;">' +
              '<button class="btn btn-ghost" type="button" data-act="addCondRoot">Add Condition</button>' +
              '<button class="btn btn-ghost" type="button" data-act="addGroupRoot">Add Group</button>' +
              '</div>';
          }

          // ACTIONS (multiple)
          cards += '<div class="sbxA-h4" style="margin-top:8px;">Actions</div>' +
            '<div class="blockActions">';

          var ai;
          for (ai = 0; ai < b.actions.length; ai++) {
            var act = b.actions[ai] || makeEmptyAction();
            var showMem = (act.target === 'memoryNumeric' || act.target === 'memoryString');

            cards += '<div class="sbxA-card sbxA-action" style="margin-top:4px; padding:6px;" data-aidx="' + ai + '">' +
              '<div class="sbxA-row wrap" style="align-items:center;">' +
              '<label class="inline">Target: ' +
              '<select class="inp actionTarget">' +
              '<option value="context.character.personality"' + (act.target === 'context.character.personality' ? ' selected' : '') + '>Personality</option>' +
              '<option value="context.character.scenario"' + (act.target === 'context.character.scenario' ? ' selected' : '') + '>Scenario</option>' +
              '<option value="context.character.example_dialogs"' + (act.target === 'context.character.example_dialogs' ? ' selected' : '') + '>Example dialogs</option>' +
              '<option value="memoryNumeric"' + (act.target === 'memoryNumeric' ? ' selected' : '') + '>memory numeric (context.character.memory[KEY])</option>' +
              '<option value="memoryString"' + (act.target === 'memoryString' ? ' selected' : '') + '>memory string (context.character.memory[KEY])</option>' +
              '</select>' +
              '</label>' +
              '<label class="inline" style="margin-left:6px;">Mode: ' +
              '<select class="inp actionMode">' +
              '<option value="append"' + (act.mode === 'append' ? ' selected' : '') + '>append</option>' +
              '<option value="set"' + (act.mode === 'set' ? ' selected' : '') + '>set</option>' +
              '<option value="add"' + (act.mode === 'add' ? ' selected' : '') + '>add (numbers only)</option>' +
              '<option value="subtract"' + (act.mode === 'subtract' ? ' selected' : '') + '>subtract (numbers only)</option>' +
              '</select>' +
              '</label>' +
              '<label class="inline memoryKeyLabel" style="margin-left:6px; display:' + (showMem ? 'inline-block' : 'none') + ';">Key: ' +
              '<input type="text" class="inp memoryKeyInput" value="' + esc(act.memKey || '') + '" placeholder="e.g. affection" />' +
              '</label>' +
              '</div>' +
              '<div class="sbxA-row wrap" style="margin-top:4px;">' +
              '<label class="inline">Action label: ' +
              '<input type="text" class="inp actionLabel" value="' + esc(act.label || '') + '" placeholder="optional label" />' +
              '</label>' +
              '</div>' +
              '<textarea class="inp sbxA-ta sbxA-mono actionText" style="margin-top:4px;" rows="3" placeholder="Action text (what to append / set / write)">' + esc(act.text || '') + '</textarea>' +
              '<div class="sbxA-row" style="margin-top:4px; justify-content:flex-end;">' +
              '<button class="btn btn-ghost" type="button" data-act="moveActionUp">Move Up</button>' +
              '<button class="btn btn-ghost" type="button" data-act="moveActionDown">Move Down</button>' +
              '<button class="btn btn-ghost" type="button" data-act="delAction">Delete</button>' +
              '</div>' +
              '</div>';
          }

          cards += '</div>';
        }

        cards += '</div></div>';
      }

      wrap.innerHTML = cards;

      // Add rule / import buttons
      var addRule = $('#sbx-rule-add');
      if (addRule) {
        addRule.onclick = function () {
          blocks.push({
            id: uid('blk'),
            type: 'if',
            label: '',
            description: '',
            join: 'and',
            conditions: [],
            actions: [makeEmptyAction()]
          });
          persist();
          renderBlocks();
        };
      }

      var importBtn = $('#sbx-import-basic');
      if (importBtn) {
        importBtn.onclick = function () {
          console.error("SBX Module: Import from Basic clicked");
          try {
            var studioState = getStudioState();
            var hasFn = (SBX.Import && typeof SBX.Import.fromBasicModule === 'function');
            console.error("SBX Module: Import function exists?", hasFn, "ModuleId:", moduleId);

            if (hasFn) {
              SBX.Import.fromBasicModule(studioState, sbxData, moduleId);
              persist();
              renderLists();
              renderDerived();
              renderBlocks();
              console.error("SBX Module: Import completed successfully");
            } else {
              console.error("SBX Module: SBX.Import.fromBasicModule is MISSING");
              // Fallback check
              if (window.SBX && window.SBX.Import) console.error("SBX.Import keys:", Object.keys(window.SBX.Import));
            }
          } catch (e) {
            console.error("SBX Module: Import failed with error:", e);
          }
        };
      }

      function findBlockAndNodeFromElement(el) {
        if (!el) return null;
        var condEl = el;
        while (condEl && condEl.getAttribute && !condEl.getAttribute('data-nid')) {
          condEl = condEl.parentNode;
        }
        if (!condEl || !condEl.getAttribute) return null;

        var nid = condEl.getAttribute('data-nid');
        if (!nid) return null;

        var blockEl = condEl;
        while (blockEl && blockEl.getAttribute && !blockEl.getAttribute('data-bidx')) {
          blockEl = blockEl.parentNode;
        }
        if (!blockEl || !blockEl.getAttribute) return null;
        var bidx = parseInt(blockEl.getAttribute('data-bidx'), 10);
        if (isNaN(bidx) || bidx < 0 || bidx >= blocks.length) return null;

        var info = findNodeByNid(blocks, bidx, nid);
        if (!info || !info.node) return null;

        info.bidx = bidx;
        info.block = blocks[bidx];
        info.blockEl = blockEl;
        info.nodeEl = condEl;
        return info;
      }

      function findBlockAndActionFromElement(el) {
        if (!el) return null;
        var actionEl = el;
        while (actionEl && actionEl.getAttribute && !actionEl.getAttribute('data-aidx')) {
          actionEl = actionEl.parentNode;
        }
        if (!actionEl || !actionEl.getAttribute) return null;
        var aidx = parseInt(actionEl.getAttribute('data-aidx'), 10);
        if (isNaN(aidx) || aidx < 0) return null;

        var blockEl = actionEl;
        while (blockEl && blockEl.getAttribute && !blockEl.getAttribute('data-bidx')) {
          blockEl = blockEl.parentNode;
        }
        if (!blockEl || !blockEl.getAttribute) return null;
        var bidx = parseInt(blockEl.getAttribute('data-bidx'), 10);
        if (isNaN(bidx) || bidx < 0 || bidx >= blocks.length) return null;

        var block = blocks[bidx] || {};
        block.actions = isArr(block.actions) ? block.actions : (block.actions = []);
        if (aidx >= block.actions.length) return null;

        return {
          bidx: bidx,
          aidx: aidx,
          block: block,
          actions: block.actions,
          actionEl: actionEl,
          blockEl: blockEl
        };
      }

      // Click actions
      dom.delegate(wrap, 'click', 'button[data-act]', function (e, btn) {
        if (e && e.preventDefault) e.preventDefault();
        var act = btn.getAttribute('data-act');
        if (!act) return;

        if (act === 'moveChainUp' || act === 'moveChainDown' || act === 'delChain') {
          var chainEl = btn;
          while (chainEl && chainEl.getAttribute && !chainEl.getAttribute('data-cidx')) chainEl = chainEl.parentNode;
          if (!chainEl) return;
          var cidx = parseInt(chainEl.getAttribute('data-cidx'), 10);
          if (isNaN(cidx) || cidx < 0 || cidx >= chains.length) return;
          var chain = chains[cidx];

          if (act === 'delChain') {
            var removeCount = (chain.end - chain.start + 1);
            blocks.splice(chain.start, removeCount);
            persist();
            renderBlocks();
            return;
          }

          if (act === 'moveChainUp' && cidx > 0) {
            var prev = chains[cidx - 1];
            var slice = blocks.splice(chain.start, chain.end - chain.start + 1);
            var insertAt = prev.start;
            blocks = blocks.slice(0, insertAt).concat(slice, blocks.slice(insertAt));
          } else if (act === 'moveChainDown' && cidx < chains.length - 1) {
            var next = chains[cidx + 1];
            var slice2 = blocks.splice(chain.start, chain.end - chain.start + 1);
            var insertAt2 = next.end + 1 - slice2.length;
            if (insertAt2 < 0) insertAt2 = 0;
            blocks = blocks.slice(0, insertAt2).concat(slice2, blocks.slice(insertAt2));
          }

          app.blocks = blocks;
          persist();
          renderBlocks();
          return;
        }

        var card = btn;
        while (card && card.getAttribute && !card.getAttribute('data-bidx')) card = card.parentNode;
        if (!card) return;
        var bidx = parseInt(card.getAttribute('data-bidx'), 10);
        if (isNaN(bidx) || bidx < 0 || bidx >= blocks.length) return;
        var block = blocks[bidx];

        // Block-level action array operations
        if (act === 'addAction') {
          block.actions = isArr(block.actions) ? block.actions : (block.actions = []);
          block.actions.push(makeEmptyAction());
          persist();
          renderBlocks();
          return;
        }
        if (act === 'delAction' || act === 'moveActionUp' || act === 'moveActionDown') {
          var infoA = findBlockAndActionFromElement(btn);
          if (!infoA) return;
          var actionsA = infoA.actions;
          var aidx = infoA.aidx;

          if (act === 'delAction') {
            actionsA.splice(aidx, 1);
          } else if (act === 'moveActionUp' && aidx > 0) {
            var tmpA = actionsA[aidx - 1];
            actionsA[aidx - 1] = actionsA[aidx];
            actionsA[aidx] = tmpA;
          } else if (act === 'moveActionDown' && aidx < actionsA.length - 1) {
            var tmpB = actionsA[aidx + 1];
            actionsA[aidx + 1] = actionsA[aidx];
            actionsA[aidx] = tmpB;
          }
          persist();
          renderBlocks();
          return;
        }

        // Condition tree actions
        if (act === 'addCondRoot' || act === 'addGroupRoot') {
          block.conditions = isArr(block.conditions) ? block.conditions : (block.conditions = []);
          if (act === 'addCondRoot') {
            block.conditions.push(makeEmptyCond());
          } else {
            block.conditions.push(makeEmptyGroup('and'));
          }
          persist();
          renderBlocks();
          return;
        }

        var info = findBlockAndNodeFromElement(btn);
        if (!info) return;

        if (act === 'addCond') {
          var node = info.node;
          if (!node || node.nodeType !== 'group') return;
          node.children = isArr(node.children) ? node.children : (node.children = []);
          node.children.push(makeEmptyCond());
          persist();
          renderBlocks();
          return;
        }
        if (act === 'addGroup') {
          var node2 = info.node;
          if (!node2 || node2.nodeType !== 'group') return;
          node2.children = isArr(node2.children) ? node2.children : (node2.children = []);
          node2.children.push(makeEmptyGroup(node2.join || 'and'));
          persist();
          renderBlocks();
          return;
        }
        if (act === 'delNode') {
          var parent = info.parent;
          var idxN = info.idx;
          if (!parent) {
            var conds = info.block.conditions || [];
            conds.splice(idxN, 1);
          } else if (parent.nodeType === 'group' && isArr(parent.children)) {
            parent.children.splice(idxN, 1);
          }
          persist();
          renderBlocks();
        }
      });

      // Textarea for actions
      dom.delegate(wrap, 'input', 'textarea.actionText', function (_e, ta) {
        var infoA = findBlockAndActionFromElement(ta);
        if (!infoA) return;
        var actionsA = infoA.actions;
        var aidx = infoA.aidx;
        var act = actionsA[aidx] || makeEmptyAction();
        act.text = ta.value || '';
        actionsA[aidx] = act;
        persist();
      });

      // Block-level joins
      dom.delegate(wrap, 'change', 'select.blockJoinType', function (_e, sel) {
        var card = sel;
        while (card && card.getAttribute && !card.getAttribute('data-bidx')) card = card.parentNode;
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-bidx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= blocks.length) return;
        var b = blocks[idx] || {};
        b.join = (sel.value || 'and').toLowerCase();
        persist();
      });

      // Block label
      dom.delegate(wrap, 'input', 'input.blockLabelInput', function (_e, inp) {
        var card = inp;
        while (card && card.getAttribute && !card.getAttribute('data-bidx')) card = card.parentNode;
        if (!card) return;
        var idx = parseInt(card.getAttribute('data-bidx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= blocks.length) return;
        var b = blocks[idx] || {};
        b.label = inp.value || '';
        blocks[idx] = b;
        persist();
      });

      // Action target / mode / memKey / label
      dom.delegate(wrap, 'change', 'select.actionTarget', function (_e, sel) {
        var infoA = findBlockAndActionFromElement(sel);
        if (!infoA) return;
        var actionsA = infoA.actions;
        var aidx = infoA.aidx;
        var act = actionsA[aidx] || makeEmptyAction();

        act.target = sel.value || 'context.character.personality';
        actionsA[aidx] = act;

        // Toggle memory key
        var isMem = (act.target === 'memoryNumeric' || act.target === 'memoryString');
        var memLabel = infoA.actionEl.getElementsByClassName('memoryKeyLabel')[0];
        if (memLabel) memLabel.style.display = isMem ? 'inline-block' : 'none';

        persist();
      });

      dom.delegate(wrap, 'change', 'select.actionMode', function (_e, sel) {
        var infoA = findBlockAndActionFromElement(sel);
        if (!infoA) return;
        var actionsA = infoA.actions;
        var aidx = infoA.aidx;
        var act = actionsA[aidx] || makeEmptyAction();
        act.mode = sel.value || 'append';
        actionsA[aidx] = act;
        persist();
      });

      dom.delegate(wrap, 'input', 'input.memoryKeyInput', function (_e, inp) {
        var infoA = findBlockAndActionFromElement(inp);
        if (!infoA) return;
        var actionsA = infoA.actions;
        var aidx = infoA.aidx;
        var act = actionsA[aidx] || makeEmptyAction();
        act.memKey = inp.value || '';
        actionsA[aidx] = act;
        persist();
      });

      dom.delegate(wrap, 'input', 'input.actionLabel', function (_e, inp) {
        var infoA = findBlockAndActionFromElement(inp);
        if (!infoA) return;
        var actionsA = infoA.actions;
        var aidx = infoA.aidx;
        var act = actionsA[aidx] || makeEmptyAction();
        act.label = inp.value || '';
        actionsA[aidx] = act;
        persist();
      });

      // Condition inputs
      dom.delegate(wrap, 'change', 'select.condType', function (_e, sel) {
        var info = findBlockAndNodeFromElement(sel);
        if (!info) return;
        var node = info.node;
        node.type = sel.value || '';
        persist();
        renderBlocks();
      });

      dom.delegate(wrap, 'change', 'select.condListSelect', function (_e, sel) {
        var info = findBlockAndNodeFromElement(sel);
        if (!info) return;
        var node = info.node;
        node.listId = sel.value || '';
        persist();
      });

      dom.delegate(wrap, 'change', 'select.condSourceSelect', function (_e, sel) {
        var info = findBlockAndNodeFromElement(sel);
        if (!info) return;
        var node = info.node;
        node.source = sel.value || 'normLastUserMsg';
        persist();
      });

      dom.delegate(wrap, 'change', 'select.condDerivedKeySelect', function (_e, sel) {
        var info = findBlockAndNodeFromElement(sel);
        if (!info) return;
        var node = info.node;
        node.derivedKey = sel.value || '';
        persist();
      });

      dom.delegate(wrap, 'input', 'input.condWindowSize', function (_e, inp) {
        var info = findBlockAndNodeFromElement(inp);
        if (!info) return;
        var node = info.node;
        var v = parseInt(inp.value, 10);
        node.windowSize = (isNaN(v) || v <= 0) ? 8 : v;
        persist();
      });

      dom.delegate(wrap, 'input', 'input.condThreshold', function (_e, inp) {
        var info = findBlockAndNodeFromElement(inp);
        if (!info) return;
        var node = info.node;
        var v = parseFloat(inp.value);
        node.threshold = isNaN(v) ? 0 : v;
        persist();
      });

      dom.delegate(wrap, 'input', 'input.condTextContains', function (_e, inp) {
        var info = findBlockAndNodeFromElement(inp);
        if (!info) return;
        var node = info.node;
        node.textContains = inp.value || '';
        persist();
      });

      dom.delegate(wrap, 'input', 'input.condMemKey', function (_e, inp) {
        var info = findBlockAndNodeFromElement(inp);
        if (!info) return;
        var node = info.node;
        node.memKey = inp.value || '';
        persist();
      });

      dom.delegate(wrap, 'change', 'select.groupJoinType', function (_e, sel) {
        var info = findBlockAndNodeFromElement(sel);
        if (!info) return;
        var node = info.node;
        if (node.nodeType !== 'group') return;
        node.join = (sel.value || 'and').toLowerCase();
        persist();
      });

      dom.delegate(wrap, 'change', 'input[type="checkbox"].condNot', function (_e, cb) {
        var info = findBlockAndNodeFromElement(cb);
        if (!info) return;
        var node = info.node;
        node.not = !!cb.checked;
        persist();
      });
    }

    renderLists();
    renderDerived();
    renderBlocks();
  }

  SBX.pages.module.render = render;

})(window);

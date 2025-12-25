(function (root) {
  'use strict';

  if (!root.Panels || !root.Panels.register) {
    throw new Error('sitebuilderx.panel.js requires panels.registry.js loaded first');
  }

  var PANEL_ID = 'adv-editor';           // mounts into #adv-editor-root
  var DATA_KEY = 'sitebuilderx';         // StudioState.data.sitebuilderx
  var STORE_KEY = 'studio.sitebuilderx'; // localStorage persistence
  var CSS_ID = 'sbx-panel-css';

  // ---------------------------
  // Helpers (ES5)
  // ---------------------------
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (_e) { }
  }

  function esc(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function uid(prefix) {
    prefix = prefix || 'id';
    return prefix + '_' + Math.floor(Math.random() * 1e9);
  }

  function normalizeBuildOrder(order) {
    if (!isArr(order)) return [];
    var out = [];
    var seen = {};
    for (var i = 0; i < order.length; i++) {
      var id = String(order[i]);
      if (!id || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  }

  function loadBuildOrder() {
    var raw = lsGet('studio.buildOrder', '');
    if (!raw) return [];
    try { return normalizeBuildOrder(JSON.parse(raw)); } catch (_e) { return []; }
  }

  // ---------------------------
  // State
  // ---------------------------
  function defaultData() {
    return {
      version: 1,
      ui: {
        selectedImportedKey: null,
        importedOpen: true,
        debugOpen: false,
        viewMode: 'editor' // 'editor' | 'test'
      },
      imported: {
        pkg: null,
        blocks: [] // normalized view for UI: [{key,moduleId,id,kind,code}]
      },
      appState: {
        lists: [],   // { id, label, description, items[] }
        derived: [], // { key, description, listId, windowSize }
        blocks: []   // { type, label, description, join, conditions[], actions[] }
      }
    };
  }

  function ensureStudioState() {
    root.StudioState = root.StudioState || {};
    root.StudioState.data = root.StudioState.data || {};
    if (!root.StudioState.data[DATA_KEY]) {
      root.StudioState.data[DATA_KEY] = defaultData();
    }
    return root.StudioState;
  }

  function loadData() {
    var st = ensureStudioState();
    var raw = lsGet(STORE_KEY, '');
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') st.data[DATA_KEY] = parsed;
      } catch (_e) { }
    }
    var d = st.data[DATA_KEY] || defaultData();

    d.ui = d.ui || { selectedImportedKey: null, importedOpen: true, debugOpen: false, viewMode: 'editor' };
    d.imported = d.imported || { pkg: null, blocks: [] };
    d.appState = d.appState || { lists: [], derived: [], blocks: [] };

    d.appState.lists = d.appState.lists || [];
    d.appState.derived = d.appState.derived || [];
    d.appState.blocks = d.appState.blocks || [];

    st.data[DATA_KEY] = d;
    return d;
  }

  function saveData() {
    var st = ensureStudioState();
    var d = st.data[DATA_KEY] || defaultData();
    lsSet(STORE_KEY, JSON.stringify(d));
  }

  // ---------------------------
  // EngineRuntime import (read-only)
  // ---------------------------
  function buildImportedFromBasic(studioState) {
    var runtime = root.DataShaper || root.EngineRuntime;
    if (!runtime || typeof runtime.buildPackage !== 'function') {
      return null;
    }
    var order = loadBuildOrder();
    try {
      var pkg = runtime.buildPackage(studioState, { buildOrder: order });
      return pkg;
    } catch (_e) {
      return null;
    }
  }

  function normalizeImportedBlocks(pkg) {
    var out = [];
    if (!pkg || !pkg.blocks || !isArr(pkg.blocks)) return out;

    for (var i = 0; i < pkg.blocks.length; i++) {
      var b = pkg.blocks[i] || {};
      var moduleId = String(b.moduleId || '');
      var bid = String(b.id || ('block.' + i));
      var kind = String(b.kind || 'script');
      var code = (b.code != null) ? String(b.code) : '';
      var key = moduleId + '::' + bid;

      out.push({
        key: key,
        moduleId: moduleId,
        id: bid,
        kind: kind,
        code: code
      });
    }
    return out;
  }

  // ---------------------------
  // Import from Logic Panels (Scoring, etc)
  // ---------------------------
  // FIX: accept current sbxData for dedupe against existing lists
  function importRulesFromBasic(studioState, sbxData) {
    var newState = {
      lists: [],
      derived: [],
      blocks: [],
      viewMode: 'editor',
      ui: { viewMode: 'editor' }
    };

    if (!studioState || !studioState.data) return newState;
    var d = studioState.data;

    var existingLists = (sbxData && sbxData.appState && sbxData.appState.lists) ? sbxData.appState.lists : [];

    function mkUid(p) { return (p || 'id') + Math.random().toString(36).substr(2, 9); }

    function mkList(items, label) {
      if (!items || !items.length) return null;
      // Deduplication check
      var stub = items.join('|');

      for (var i = 0; i < newState.lists.length; i++) {
        var ex = newState.lists[i];
        if (ex && ex.items && ex.items.join('|') === stub) return ex.id;
      }
      for (var j = 0; j < existingLists.length; j++) {
        var ex2 = existingLists[j];
        if (ex2 && ex2.items && ex2.items.join('|') === stub) return ex2.id;
      }

      var id = mkUid('lst');
      newState.lists.push({ id: id, label: label, items: items.slice() });
      return id;
    }

    function mkBlock(conds, acts, label, groupId) {
      if (!acts || !acts.length) return;
      newState.blocks.push({
        id: mkUid('blk'),
        label: label || 'Imported Block',
        groupId: groupId || '',
        type: 'if',
        join: 'AND',
        conditions: conds || [],
        actions: acts
      });
    }

    // 1. SCORING
    if (d.scoring && d.scoring.enabled !== false && d.scoring.rules) {
      for (var i = 0; i < d.scoring.rules.length; i++) {
        var r = d.scoring.rules[i];
        if (!r || r.enabled === false) continue;

        var conds = [];
        if (r.keywords && r.keywords.length) {
          var lid = mkList(r.keywords, "Score: " + (r.name || "Rule " + (i + 1)));
          if (lid) conds.push({ type: 'anyInList', listId: lid, source: 'normLastUserMsg' });
        }

        var acts = [];
        var val = parseInt(r.scoreVal, 10) || 0;
        if (val !== 0) acts.push({ type: 'memoryNumeric', memKey: 'score', mode: 'append', text: String(val) });

        if (conds.length && acts.length) mkBlock(conds, acts, "Scoring: " + (r.name || "Rule"), "Scoring");
      }
    }

    // 2. AMBIENT
    if (d.ambient && d.ambient.enabled !== false && d.ambient.groups) {
      for (var i2 = 0; i2 < d.ambient.groups.length; i2++) {
        var g = d.ambient.groups[i2];
        if (!g || g.enabled === false) continue;

        var items = [];
        for (var j2 = 0; j2 < (g.items || []).length; j2++) {
          var it = g.items[j2];
          if (it && it.enabled !== false && it.text) items.push(it.text);
        }
        if (!items.length) continue;

        var listId = mkList(items, "Ambient: " + (g.name || "Group"));
        var pct = parseInt(g.triggerChancePct, 10);
        if (isNaN(pct)) pct = 10;

        var conds2 = [{ type: 'randomChance', threshold: pct }];
        var acts2 = [{ type: 'appendRandomFromList', target: 'appendScenario', listId: listId }];

        mkBlock(conds2, acts2, "Ambient: " + (g.name || "Group"), "Ambient Rules");
      }
    }

    // 3. RANDOM
    if (d.random && d.random.enabled !== false && d.random.groups) {
      for (var i3 = 0; i3 < d.random.groups.length; i3++) {
        var g2 = d.random.groups[i3];
        if (!g2 || g2.enabled === false) continue;

        var items2 = [];
        for (var j3 = 0; j3 < (g2.items || []).length; j3++) {
          var it2 = g2.items[j3];
          if (it2 && it2.enabled !== false && it2.text) items2.push(it2.text);
        }
        if (!items2.length) continue;

        var listId2 = mkList(items2, "Random: " + (g2.name || "Group"));
        var pct2 = parseInt(g2.triggerChancePct, 10);
        if (isNaN(pct2)) pct2 = 15;

        var tgt = (g2.writeTargetId === 'character.scenario') ? 'appendScenario' : 'appendPersonality';

        var conds3 = [{ type: 'randomChance', threshold: pct2 }];
        var acts3 = [{ type: 'appendRandomFromList', target: tgt, listId: listId2 }];

        mkBlock(conds3, acts3, "Random: " + (g2.name || "Group"), "Random Events");
      }
    }

    // 4. EVENTS
    if (d.events && d.events.enabled !== false && d.events.rules) {
      for (var i4 = 0; i4 < d.events.rules.length; i4++) {
        var r2 = d.events.rules[i4];
        if (!r2 || r2.enabled === false || !r2.text) continue;

        var min = parseInt(r2.msgCountMin, 10) || 0;
        var max = parseInt(r2.msgCountMax, 10) || 0;

        var conds4 = [];
        if (min > 0) conds4.push({ type: 'messageCountComparison', op: '>=', threshold: min });
        if (max > 0 && max >= min) conds4.push({ type: 'messageCountComparison', op: '<=', threshold: max });

        var acts4 = [{ type: 'appendScenario', text: r2.text }];

        if (r2.once) {
          var memKey = 'evt_' + mkUid('');
          conds4.push({ type: 'memoryNumberComparison', memKey: memKey, op: '==', threshold: 0 });
          acts4.unshift({ type: 'memoryNumeric', memKey: memKey, mode: 'set', text: '1' });
        }

        mkBlock(conds4, acts4, "Event: " + (r2.name || "Rule"), "Events Panel");
      }
    }

    // 5. MEMORY
    if (d.memory && d.memory.enabled !== false && d.memory.entries) {
      for (var i5 = 0; i5 < d.memory.entries.length; i5++) {
        var r3 = d.memory.entries[i5];
        if (!r3 || r3.enabled === false) continue;

        var conds5 = [];
        if (r3.keywords && r3.keywords.length) {
          var lid2 = mkList(r3.keywords, "Mem: " + (r3.name || "Entry " + (i5 + 1)));
          if (lid2) conds5.push({ type: 'anyInList', listId: lid2, source: 'normLastUserMsg' });
        }

        var val3 = r3.value || '';
        var acts5 = [];
        var isNum = (r3.op === 'add' || r3.op === 'sub' || (r3.op === 'set' && !isNaN(parseFloat(val3))));
        var key3 = r3.key || 'memvar';

        if (isNum) {
          var n = parseFloat(val3) || 0;
          var mode3 = (r3.op === 'sub') ? 'append' : (r3.op === 'add' ? 'append' : 'set');
          if (r3.op === 'sub') n = -n;
          acts5.push({ type: 'memoryNumeric', memKey: key3, mode: mode3, text: String(n) });
        } else {
          acts5.push({ type: 'memoryString', memKey: key3, mode: 'set', text: val3 });
        }

        if (conds5.length && acts5.length) mkBlock(conds5, acts5, "Memory: " + (r3.name || "Entry"), "Memory Rules");
      }
    }

    // 6. LOREBOOK
    if (d.lorebook && d.lorebook.enabled !== false && d.lorebook.entries) {
      for (var i6 = 0; i6 < d.lorebook.entries.length; i6++) {
        var r4 = d.lorebook.entries[i6];
        if (!r4 || r4.enabled === false || !r4.text) continue;

        var conds6 = [];
        if (r4.keywords) {
          var kws = String(r4.keywords).split(/[,;\n\r]+/);
          var cleanKws = [];
          for (var k = 0; k < kws.length; k++) {
            var trimK = kws[k].replace(/^\s+|\s+$/g, '');
            if (trimK) cleanKws.push(trimK);
          }

          if (cleanKws.length) {
            var lid3 = mkList(cleanKws, "LB: " + (r4.title || "Entry " + (i6 + 1)));
            if (lid3) conds6.push({ type: 'anyInList', listId: lid3, source: 'normLastUserMsg' });
          }
        }

        var tgt2 = (r4.target === 'personality') ? 'appendPersonality' : 'appendScenario';
        var acts6 = [{ type: tgt2, text: r4.text }];

        if (conds6.length && acts6.length) mkBlock(conds6, acts6, "LB: " + (r4.title || "Entry"), "Lorebook");
      }
    }

    // 7. VOICES
    if (d.voices && d.voices.enabled !== false && d.voices.voices) {
      for (var i7 = 0; i7 < d.voices.voices.length; i7++) {
        var v = d.voices.voices[i7];
        if (!v || v.enabled === false) continue;

        var chance = (v.attempt && v.attempt.baseChance) ? (parseFloat(v.attempt.baseChance) * 100) : 60;
        var conds7 = [{ type: 'randomChance', threshold: Math.round(chance) }];

        var acts7 = [];
        if (v.baselineRail && v.baselineRail.trim()) {
          acts7.push({ type: 'appendPersonality', text: v.baselineRail.trim() });
        }

        if (v.subtones && v.subtones.length) {
          var rails = [];
          for (var s = 0; s < v.subtones.length; s++) {
            var st = v.subtones[s];
            if (st.rail && st.rail.trim()) rails.push(st.rail.trim());
          }
          if (rails.length) {
            var lid4 = mkList(rails, "Voice: " + (v.characterName || "Voice") + " Subtones");
            if (lid4) {
              acts7.push({ type: 'appendRandomFromList', target: 'appendPersonality', listId: lid4 });
            }
          }
        }

        if (acts7.length) {
          mkBlock(conds7, acts7, "Voice: " + (v.characterName || "Voice " + (i7 + 1)), "Voices: " + (v.characterName || "General"));
        }
      }
    }

    // 8. TONE
    if (d.tone && d.tone.enabled !== false && d.tone.entries) {
      for (var i8 = 0; i8 < d.tone.entries.length; i8++) {
        var r5 = d.tone.entries[i8];
        if (!r5 || r5.enabled === false || !r5.response) continue;

        var conds8 = [];
        if (r5.keywords && r5.keywords.length) {
          var lid5 = mkList(r5.keywords, "Tone: " + (r5.name || "Entry " + (i8 + 1)));
          if (lid5) conds8.push({ type: 'anyInList', listId: lid5, source: 'normLastUserMsg', negationGuard: true });
        }

        var acts8 = [{ type: 'appendExampleDialogs', text: r5.response }];
        if (conds8.length) mkBlock(conds8, acts8, "Tone: " + (r5.name || "Entry"));
      }
    }

    // 9. COND COMBINER
    if (d.conditionCombiner && d.conditionCombiner.enabled !== false && d.conditionCombiner.rules) {
      var scoringTopicMap = {};
      if (d.scoring && d.scoring.topics) {
        for (var st2 = 0; st2 < d.scoring.topics.length; st2++) {
          var top = d.scoring.topics[st2];
          if (top && top.id) scoringTopicMap[top.id] = top;
        }
      }

      for (var i9 = 0; i9 < d.conditionCombiner.rules.length; i9++) {
        var r6 = d.conditionCombiner.rules[i9];
        if (!r6 || r6.enabled === false) continue;

        var conds9 = [];
        var c = r6.conditions || {};

        if (c.keywordsEnabled && c.keywordsText) {
          var kws2 = String(c.keywordsText).split(/[,;\n\r]+/);
          var cleanKws2 = [];
          for (var k2 = 0; k2 < kws2.length; k2++) {
            var trimK2 = kws2[k2].replace(/^\s+|\s+$/g, '');
            if (trimK2) cleanKws2.push(trimK2);
          }
          if (cleanKws2.length) {
            var lid6 = mkList(cleanKws2, "CC: " + (r6.name || "Rule " + (i9 + 1)));
            if (lid6) conds9.push({ type: 'anyInList', listId: lid6, source: 'normLastUserMsg' });
          }
        }

        if (c.windowEnabled) {
          var min2 = parseInt(c.windowMin, 10) || 0;
          var max2 = parseInt(c.windowMax, 10) || 0;
          var useMax = (c.windowUseMax === true);

          conds9.push({ type: 'messageCountComparison', op: '>=', threshold: min2 });
          if (useMax && max2 >= min2) {
            conds9.push({ type: 'messageCountComparison', op: '<=', threshold: max2 });
          }
        }

        if (c.scoringEnabled && c.scoringTopicId && scoringTopicMap[c.scoringTopicId]) {
          var stopic = scoringTopicMap[c.scoringTopicId];
          if (stopic.keywords && stopic.keywords.length) {
            var slistId = mkList(stopic.keywords, "Score: " + (stopic.name || "Ref"));
            if (slistId) {
              var sMin = parseInt(stopic.min, 10) || 1;
              var sWin = parseInt(stopic.depth, 10) || 10;
              conds9.push({ type: 'countInHistory', listId: slistId, op: '>=', threshold: sMin, windowSize: sWin });
            }
          }
        }

        var tgt3 = (r6.writeTargetId === 'character.scenario') ? 'appendScenario' : 'appendPersonality';
        var acts9 = [{ type: tgt3, text: r6.contextFieldText }];

        if (conds9.length && r6.contextFieldText) {
          mkBlock(conds9, acts9, "CC: " + (r6.name || "Rule"), "Condition Combiner");
        }
      }
    }

    return newState;
  }

  // ---------------------------
  // SBX Core logic
  // ---------------------------
  function getListById(appState, listId) {
    for (var i = 0; i < appState.lists.length; i++) {
      if (appState.lists[i] && appState.lists[i].id === listId) return appState.lists[i];
    }
    return null;
  }

  function splitLines(s) {
    s = String(s == null ? '' : s);
    var lines = s.split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = String(lines[i]).replace(/^\s+|\s+$/g, '');
      if (t) out.push(t);
    }
    return out;
  }

  function makeDefaultCondition() {
    return { nodeType: 'cond', not: false, type: 'historyContainsList', listId: '', windowSize: 8, op: '>=', threshold: 1 };
  }
  function makeDefaultGroup() {
    return { nodeType: 'group', not: false, join: 'and', items: [] };
  }
  function makeDefaultAction() {
    return { type: 'appendPersonality', text: '' };
  }

  function makeDefaultBlock(type) {
    return {
      type: type,            // "if" | "elseif" | "else"
      label: '',
      description: '',
      join: 'AND',           // AND/OR for conditions
      conditions: (type === 'else') ? [] : [makeDefaultCondition()],
      actions: [makeDefaultAction()]
    };
  }

  function validateConfig(appState) {
    var msgs = [];
    var hasIf = false;
    var hasElse = false;
    for (var i = 0; i < appState.blocks.length; i++) {
      var b = appState.blocks[i] || {};
      var lbl = b.label || ('block #' + (i + 1));
      if (b.type === 'if') { hasIf = true; hasElse = false; }
      if (b.type === 'elseif' && !hasIf) msgs.push('ELSE IF without a preceding IF near ' + lbl + '.');
      if (b.type === 'else') {
        if (!hasIf) msgs.push('ELSE without a preceding IF near ' + lbl + '.');
        if (hasElse) msgs.push('Multiple ELSE blocks in the same IF/ELSE chain near ' + lbl + '.');
        hasElse = true;
      }
      if ((b.type === 'if' || b.type === 'elseif') && (!b.conditions || !b.conditions.length)) {
        msgs.push("IF/ELSE IF block '" + lbl + "' has no conditions; it will always be true.");
      }
      if (!b.actions || !b.actions.length) {
        msgs.push("Block '" + lbl + "' has no actions and does nothing.");
      }
    }
    return msgs;
  }

  function generateCode(appState) {
    var lines = [];
    var i;

    lines.push('// Generated by Janitor Studio - ScriptBuilder X (Phase 1)');
    lines.push('// Paste into JanitorAI Advanced Script.');
    lines.push('');

    if (appState.lists.length) {
      for (i = 0; i < appState.lists.length; i++) {
        var list = appState.lists[i] || {};
        var lid = String(list.id || '');
        if (!lid) continue;
        var items = isArr(list.items) ? list.items : [];
        if (list.label || list.description) {
          var c = '// List: ' + (list.label || lid);
          if (list.description) c += ' - ' + list.description;
          lines.push(c);
        }
        lines.push('var ' + lid + ' = ' + JSON.stringify(items) + ';');
      }
      lines.push('');
    } else {
      lines.push('// No lists defined.');
      lines.push('');
    }

    lines.push('// Helpers');
    lines.push('function __sbx_isArr(x){ return Object.prototype.toString.call(x)==="[object Array]"; }');
    lines.push('function __sbx_norm(s){');
    lines.push('  s = String(s == null ? "" : s);');
    lines.push('  return s.toLowerCase();');
    lines.push('}');
    lines.push('function __sbx_last_messages(ctx){');
    lines.push('  var a = (ctx && ctx.chat && ctx.chat.last_messages) ? ctx.chat.last_messages : [];');
    lines.push('  // Support both array-of-strings and array-of-objects with {message}');
    lines.push('  if (__sbx_isArr(a) && a.length && typeof a[0] === "object") {');
    lines.push('    var out = [];');
    lines.push('    for (var i=0; i<a.length; i++) out.push(String((a[i] && a[i].message) || ""));');
    lines.push('    a = out;');
    lines.push('  }');
    lines.push('  if (!a || !a.length) {');
    lines.push('    var lm = (ctx && ctx.chat && typeof ctx.chat.last_message === "string") ? ctx.chat.last_message : "";');
    lines.push('    if (lm) a = [lm];');
    lines.push('  }');
    lines.push('  return a || [];');
    lines.push('}');
    lines.push('function __sbx_norm_history(arr, maxN){');
    lines.push('  var out = [];');
    lines.push('  if (!arr) return out;');
    lines.push('  var start = 0;');
    lines.push('  if (typeof maxN === "number" && maxN > 0 && arr.length > maxN) start = arr.length - maxN;');
    lines.push('  var i;');
    lines.push('  for (i = start; i < arr.length; i++) out.push(__sbx_norm(arr[i]));');
    lines.push('  return out;');
    lines.push('}');
    lines.push('function __sbx_countMatches(normHistory, list, windowSize){');
    lines.push('  list = list || [];');
    lines.push('  var start = 0;');
    lines.push('  if (typeof windowSize === "number" && windowSize > 0 && normHistory.length > windowSize) start = normHistory.length - windowSize;');
    lines.push('  var count = 0;');
    lines.push('  var i, j;');
    lines.push('  for (i = start; i < normHistory.length; i++) {');
    lines.push('    var msg = normHistory[i] || "";');
    lines.push('    for (j = 0; j < list.length; j++) {');
    lines.push('      var kw = __sbx_norm(list[j]);');
    lines.push('      if (kw && msg.indexOf(kw) !== -1) { count++; break; }');
    lines.push('    }');
    lines.push('  }');
    lines.push('  return count;');
    lines.push('}');
    lines.push('function __sbx_listAny(list, target){');
    lines.push('  if (!list || !list.length) return false;');
    lines.push('  if (typeof target === "string") {');
    lines.push('    var t = __sbx_norm(target);');
    lines.push('    for (var i=0; i<list.length; i++) if (t.indexOf(__sbx_norm(list[i])) !== -1) return true;');
    lines.push('  } else if (__sbx_isArr(target)) {');
    lines.push('    for (var i=0; i<target.length; i++) {');
    lines.push('      var msg = __sbx_norm(target[i]);');
    lines.push('      for (var j=0; j<list.length; j++) if (msg.indexOf(__sbx_norm(list[j])) !== -1) return true;');
    lines.push('    }');
    lines.push('  }');
    lines.push('  return false;');
    lines.push('}');
    lines.push('function __sbx_historyContains(normHistory, txt, windowSize){');
    lines.push('  var start = 0;');
    lines.push('  if (typeof windowSize === "number" && windowSize > 0 && normHistory.length > windowSize) start = normHistory.length - windowSize;');
    lines.push('  for (var i = start; i < normHistory.length; i++) if (normHistory[i].indexOf(txt) !== -1) return true;');
    lines.push('  return false;');
    lines.push('}');
    lines.push('function __sbx_listAnyNegation(list, target){');
    lines.push('  if (!list || !list.length) return false;');
    lines.push('  var tVals = [];');
    lines.push('  if (typeof target === "string") tVals = [__sbx_norm(target)];');
    lines.push('  else if (__sbx_isArr(target)) {');
    lines.push('    for (var i=0; i<target.length; i++) tVals.push(__sbx_norm(target[i]));');
    lines.push('  }');
    lines.push('  else return false;');
    lines.push('  var negs = ["not", "no", "never", "don\\\'t", "dont", "won\\\'t", "wont", "can\\\'t", "cant", "without"];');
    lines.push('  for (var i=0; i<tVals.length; i++) {');
    lines.push('    var hay = String(tVals[i] || "");');
    lines.push('    for (var j=0; j<list.length; j++) {');
    lines.push('      var needle = __sbx_norm(list[j]);');
    lines.push('      if (!needle) continue;');
    lines.push('      var idx = -1;');
    lines.push('      while ((idx = hay.indexOf(needle, idx+1)) !== -1) {');
    lines.push('         var pre = hay.substring(0, idx);');
    lines.push('         var isNeg = false;');
    lines.push('         for (var k=0; k<negs.length; k++) {');
    lines.push('             var re = new RegExp("(?:^|[\\\\s\\\\W])" + negs[k] + "[\\\\s\\\\W]*$");');
    lines.push('             if (re.test(pre)) { isNeg = true; break; }');
    lines.push('         }');
    lines.push('         if (!isNeg) return true;');
    lines.push('      }');
    lines.push('    }');
    lines.push('  }');
    lines.push('  return false;');
    lines.push('}');
    lines.push('');

    lines.push('// Context');
    lines.push('var lastMessages = __sbx_last_messages(context);');
    lines.push('var normHistory = __sbx_norm_history(lastMessages, 50);');
    lines.push('');

    lines.push('// Derived values (recomputed every run)');
    lines.push('var derived = {};');
    if (appState.derived.length) {
      for (i = 0; i < appState.derived.length; i++) {
        var d = appState.derived[i] || {};
        var key = String(d.key || '');
        var listId = String(d.listId || '');
        var ws = (typeof d.windowSize === 'number') ? d.windowSize : parseInt(d.windowSize, 10);
        if (!key || !listId) continue;
        if (isNaN(ws) || ws <= 0) ws = 10;
        lines.push('derived[' + JSON.stringify(key) + '] = __sbx_countMatches(normHistory, ' + listId + ', ' + ws + ');');
      }
    } else {
      lines.push('// (none)');
    }
    lines.push('');

    lines.push('// Action helpers (safe append)');
    lines.push('function __sbx_append(path, txt){');
    lines.push('  txt = String(txt == null ? "" : txt);');
    lines.push('  if (!txt) return;');
    lines.push('  context.character = context.character || {};');
    lines.push('  var cur = String(context.character[path] == null ? "" : context.character[path]);');
    lines.push('  if (cur && cur.charAt(cur.length - 1) !== "\\n") cur += "\\n";');
    lines.push('  context.character[path] = cur + txt;');
    lines.push('}');
    lines.push('function __sbx_appendRandom(path, list){');
    lines.push('  if (!list || !list.length) return;');
    lines.push('  var idx = Math.floor(Math.random() * list.length);');
    lines.push('  __sbx_append(path, list[idx]);');
    lines.push('}');
    lines.push('');

    lines.push('// Trigger blocks');
    lines.push('(function(){');

    function condExpr(c) {
      if (!c) return 'true';
      var t = String(c.type || '');
      var op = String(c.op || '>=');
      var safeOps = { '>': 1, '>=': 1, '<': 1, '<=': 1, '==': 1, '!=': 1, 'every': 1 };
      if (!safeOps[op]) op = '>=';

      var th = parseFloat(c.threshold);
      if (isNaN(th)) th = 0;

      if (t === 'anyInList' || t === 'noneInList') {
        var lid = String(c.listId || '');
        if (!lid) return (t === 'noneInList' ? 'true' : 'false');
        var src = (c.source === 'normHistory') ? 'normHistory' : '(context.chat && context.chat.last_message ? context.chat.last_message : "")';
        if (c.negationGuard && t === 'anyInList') {
          return '__sbx_listAnyNegation(' + lid + ', ' + src + ')';
        }
        var check = '__sbx_listAny(' + lid + ', ' + src + ')';
        return (t === 'noneInList') ? ('!' + check) : check;
      }

      if (t === 'historyContainsList' || t === 'countInHistory') {
        var lid2 = String(c.listId || '');
        var ws2 = parseInt(c.windowSize, 10);
        if (isNaN(ws2) || ws2 <= 0) ws2 = 5;
        if (!lid2) return 'false';
        return '(__sbx_countMatches(normHistory, ' + lid2 + ', ' + ws2 + ') ' + op + ' ' + th + ')';
      }

      if (t === 'messageCountComparison') {
        if (op === 'every') return '((context.chat && context.chat.chat_metadata && context.chat.chat_metadata.public_message_count) % ' + th + ' === 0)';
        return '((context.chat && context.chat.chat_metadata && context.chat.chat_metadata.public_message_count) ' + op + ' ' + th + ')';
      }

      if (t === 'personalityContains' || t === 'scenarioContains' || t === 'messageHistoryContains' || t === 'memoryStringContains') {
        var txt = JSON.stringify(String(c.text || '').toLowerCase());
        var ci = (c.caseInsensitive !== false);

        var target = '';
        if (t === 'personalityContains') target = '(context.character.personality || "")';
        if (t === 'scenarioContains') target = '(context.character.scenario || "")';
        if (t === 'memoryStringContains') {
          var k = JSON.stringify(String(c.memKey || ''));
          target = '((context.character.memory && context.character.memory[' + k + ']) || "")';
        }

        if (t === 'messageHistoryContains') {
          var ws3 = parseInt(c.windowSize, 10);
          if (isNaN(ws3) || ws3 <= 0) ws3 = 5;
          return '(__sbx_historyContains(normHistory, ' + txt + ', ' + ws3 + '))';
        }

        var expr = target + (ci ? '.toLowerCase()' : '') + '.indexOf(' + txt + ') !== -1';
        return '(' + expr + ')';
      }

      if (t === 'memoryNumberComparison') {
        var k2 = JSON.stringify(String(c.memKey || ''));
        return '((context.character.memory && parseFloat(context.character.memory[' + k2 + ']) || 0) ' + op + ' ' + th + ')';
      }

      if (t === 'derivedNumberComparison') {
        var k3 = JSON.stringify(String(c.derivedKey || ''));
        return '((derived[' + k3 + '] || 0) ' + op + ' ' + th + ')';
      }

      if (t === 'randomChance') {
        return '(Math.random() * 100 < ' + th + ')';
      }

      return 'true';
    }

    function condNodeExpr(node) {
      if (!node) return 'true';
      if (node.nodeType === 'group' || node.kind === 'group') {
        var join = String(node.join || 'and').toLowerCase() === 'or' ? 'or' : 'and';
        var items = isArr(node.items) ? node.items : [];
        var parts = [];
        for (var i = 0; i < items.length; i++) parts.push(condNodeExpr(items[i]));
        var expr = parts.length ? parts.join(join === 'and' ? ' && ' : ' || ') : 'true';
        if (node.not) expr = '!' + '(' + expr + ')';
        return '(' + expr + ')';
      }
      var e = condExpr(node);
      if (node.not) e = '!' + '(' + e + ')';
      return '(' + e + ')';
    }

    function actionStmt(a) {
      if (!a) return '';
      var t = String(a.type || '');
      var txt = String(a.text == null ? '' : a.text);

      if (t === 'appendPersonality') return '__sbx_append("personality", ' + JSON.stringify(txt) + ');';
      if (t === 'appendScenario') return '__sbx_append("scenario", ' + JSON.stringify(txt) + ');';
      if (t === 'appendExampleDialogs') return '__sbx_append("example_dialogs", ' + JSON.stringify(txt) + ');';

      if (t === 'appendRandomFromList') {
        var tgt = (a.target === 'appendScenario') ? 'scenario' : ((a.target === 'appendExampleDialogs') ? 'example_dialogs' : 'personality');
        var lid = String(a.listId || '');
        if (lid) return '__sbx_appendRandom("' + tgt + '", ' + lid + ');';
        return '';
      }

      if (t === 'memoryNumeric' || t === 'memoryString') {
        var k = JSON.stringify(String(a.memKey || ''));
        var mode = String(a.mode || 'set');
        var val = (t === 'memoryNumeric') ? parseFloat(txt) : txt;
        if (t === 'memoryNumeric' && isNaN(val)) val = 0;

        var valStr = JSON.stringify(val);
        var line = 'context.character.memory = context.character.memory || {}; ';
        if (mode === 'append' && t === 'memoryString') {
          line += 'context.character.memory[' + k + '] = (context.character.memory[' + k + '] || "") + ' + valStr + ';';
        } else if (mode === 'append' && t === 'memoryNumeric') {
          line += 'context.character.memory[' + k + '] = (parseFloat(context.character.memory[' + k + ']) || 0) + ' + valStr + ';';
        } else {
          line += 'context.character.memory[' + k + '] = ' + valStr + ';';
        }
        return line;
      }

      return '';
    }

    for (i = 0; i < appState.blocks.length; i++) {
      var b = appState.blocks[i] || {};
      var btype = String(b.type || 'if');
      var join = (String(b.join || 'AND').toUpperCase() === 'OR') ? 'OR' : 'AND';
      var conds = isArr(b.conditions) ? b.conditions : [];
      var acts = isArr(b.actions) ? b.actions : [];

      var expr = 'true';
      if (btype !== 'else') {
        if (!conds.length) expr = 'true';
        else {
          var parts = [];
          for (var ci = 0; ci < conds.length; ci++) parts.push(condNodeExpr(conds[ci]));
          expr = parts.join(join === 'AND' ? ' && ' : ' || ');
        }
      }

      if (btype === 'if') lines.push('  if (' + expr + ') {');
      else if (btype === 'elseif') lines.push('  else if (' + expr + ') {');
      else lines.push('  else {');

      if (acts.length) {
        for (var ai = 0; ai < acts.length; ai++) {
          var st = actionStmt(acts[ai]);
          if (st) lines.push('    ' + st);
        }
      }
      lines.push('  }');
    }

    lines.push('})();');
    lines.push('');

    var msgs = validateConfig(appState);
    if (msgs.length) {
      lines.unshift('// WARNINGS:');
      for (i = 0; i < msgs.length; i++) lines.unshift('// - ' + msgs[i]);
      lines.unshift('//');
    }

    return lines.join('\n');
  }

  // ---------------------------
  // Test Harness (Logic)
  // ---------------------------
  var thState = { messages: [] };

  function thNormalize(str) {
    str = (str || "");
    str = String(str).toLowerCase();
    str = str.replace(/[^a-z0-9_\s-]/g, " ");
    str = str.replace(/[-_]+/g, " ");
    str = str.replace(/\s+/g, " ");
    return str.trim();
  }

  function thGetListItems(appState, listId) {
    var i;
    for (i = 0; i < appState.lists.length; i++) {
      if (appState.lists[i].id === listId) return (appState.lists[i].items || []);
    }
    return [];
  }

  function thAnyInList(text, list) {
    text = String(text || "").toLowerCase();
    var i;
    for (i = 0; i < list.length; i++) {
      var needle = String(list[i] || "").toLowerCase();
      if (!needle) continue;
      if (text.indexOf(needle) !== -1) return true;
    }
    return false;
  }
  function thNoneInList(text, list) { return !thAnyInList(text, list); }
  function thAnyInListNegation(text, list) {
    text = String(text || "").toLowerCase();
    var negs = ["not", "no", "never", "don't", "dont", "won't", "wont", "can't", "cant", "without"];
    var i;
    for (i = 0; i < list.length; i++) {
      var needle = String(list[i] || "").toLowerCase();
      if (!needle) continue;
      var idx = -1;
      while ((idx = text.indexOf(needle, idx + 1)) !== -1) {
        var pre = text.substring(0, idx);
        var isNeg = false;
        for (var k = 0; k < negs.length; k++) {
          var re = new RegExp("(?:^|[\\s\\W])" + negs[k] + "[\\s\\W]*$");
          if (re.test(pre)) { isNeg = true; break; }
        }
        if (!isNeg) return true;
      }
    }
    return false;
  }

  function thCountMatchesInHistory(normHistory, list, windowSize) {
    var count = 0;
    var len = normHistory.length;
    var start = 0;
    if (windowSize && windowSize > 0 && windowSize < len) start = len - windowSize;
    var i;
    for (i = start; i < len; i++) {
      if (thAnyInList(normHistory[i], list)) count++;
    }
    return count;
  }

  function thCompare(op, left, right) {
    if (op === ">=") return left >= right;
    if (op === ">") return left > right;
    if (op === "==") return left == right;
    if (op === "!=") return left != right;
    if (op === "<=") return left <= right;
    if (op === "<") return left < right;
    return false;
  }

  function thFindFirstMatch(text, list) {
    var hay = String(text || "").toLowerCase();
    var i;
    for (i = 0; i < list.length; i++) {
      var raw = String(list[i] || "");
      var needle = raw.toLowerCase();
      if (!needle) continue;
      if (hay.indexOf(needle) !== -1) return raw;
    }
    return "";
  }

  function thExplainLeaf(node, env, gateNo) {
    var t = node.type || "";
    var out = { ok: true, lines: [] };

    function push(s) { out.lines.push("Gate " + gateNo + " -> " + s); }

    if (t === "anyInList" || t === "noneInList") {
      var items = thGetListItems(env.appState, node.listId);
      var ok;
      if (node.negationGuard && t === "anyInList") {
        var matchSafe = thAnyInListNegation(env.normLastUserMsg, items);
        if (matchSafe) push('Target text included a SAFE (non-negated) match.');
        else push('Target text did NOT include any safe matches (matches were either missing or negated by "not", "no", etc).');
        ok = matchSafe;
      } else {
        var match = thFindFirstMatch(env.normLastUserMsg, items);
        ok = (t === "anyInList") ? !!match : !match;

        if (t === "anyInList") {
          if (ok) push('Target text included "' + match + '".');
          else push('Target text did not include any of the target phrases.');
        } else {
          if (ok) push('Target text did not include any of the target phrases.');
          else push('Target text included "' + match + '" (but it should NOT).');
        }
      }
      out.ok = ok;

    } else if (t === "countInHistory" || t === "historyContainsList") {
      var items2 = thGetListItems(env.appState, node.listId);
      var win = (typeof node.windowSize === "number") ? node.windowSize : (parseInt(node.windowSize, 10) || 10);
      var op = node.op || ">=";
      var thr = (typeof node.threshold === "number") ? node.threshold : (parseFloat(node.threshold) || 1);
      var cnt = thCountMatchesInHistory(env.normHistory, items2, win);
      var ok2 = thCompare(op, cnt, thr);
      push('In the last ' + win + ' message(s), the count was ' + cnt + ' (needs ' + op + ' ' + thr + ').');
      out.ok = ok2;

    } else if (t === "messageCountComparison") {
      var op2 = node.op || ">=";
      var thr2 = (typeof node.threshold === "number") ? node.threshold : (parseFloat(node.threshold) || 1);
      var mc = env.messageCount || 0;
      var ok3;
      if (op2 === 'every') {
        ok3 = (mc > 0 && (mc % thr2 === 0));
        push('Message count ' + mc + (ok3 ? ' is multiple of ' : ' is NOT multiple of ') + thr2 + '.');
      } else {
        ok3 = thCompare(op2, mc, thr2);
        push('Message count was ' + mc + ' (needs ' + op2 + ' ' + thr2 + ').');
      }
      out.ok = ok3;

    } else if (t === "messageHistoryContains") {
      var needleH = thNormalize(String(node.text || ""));
      var winH = (typeof node.windowSize === "number") ? node.windowSize : (parseInt(node.windowSize, 10) || 5);
      var lenH = env.normHistory.length;
      var startH = 0;
      if (winH && winH > 0 && winH < lenH) startH = lenH - winH;
      var idxFound = -1;
      var ii;
      for (ii = startH; ii < lenH; ii++) {
        if (env.normHistory[ii].indexOf(needleH) !== -1) { idxFound = ii; break; }
      }
      var okH = (idxFound !== -1);
      if (okH) push('Last ' + winH + ' messages included "' + String(node.text || "") + '" (found in Message ' + (idxFound + 1) + ').');
      else push('Last ' + winH + ' messages did not include "' + String(node.text || "") + '".');
      out.ok = okH;

    } else if (t === "personalityContains" || t === "scenarioContains") {
      var fieldName = (t === "personalityContains") ? "Personality" : "Scenario";
      var hay = (t === "personalityContains") ? String(env.context.character.personality || "") : String(env.context.character.scenario || "");
      var needle = String(node.text || "");
      var ci = (node.caseInsensitive !== false);
      var ok4 = ci ? (hay.toLowerCase().indexOf(needle.toLowerCase()) !== -1) : (hay.indexOf(needle) !== -1);
      push(fieldName + (ok4 ? ' included "' : ' did not include "') + needle + '".');
      out.ok = ok4;

    } else if (t === "memoryNumberComparison") {
      var k = String(node.memKey || "");
      var op3 = node.op || ">=";
      var thr3 = (typeof node.threshold === "number") ? node.threshold : (parseFloat(node.threshold) || 0);
      var v = Number((env.context.character.memory && env.context.character.memory[k]) || 0);
      var ok5 = thCompare(op3, v, thr3);
      push('Memory number "' + k + '" was ' + v + ' (needs ' + op3 + ' ' + thr3 + ').');
      out.ok = ok5;

    } else if (t === "memoryStringContains") {
      var k2 = String(node.memKey || "");
      var needle2 = String(node.text || "");
      var ci2 = (node.caseInsensitive !== false);
      var s2 = String((env.context.character.memory && env.context.character.memory[k2]) || "");
      var ok6 = ci2 ? (s2.toLowerCase().indexOf(needle2.toLowerCase()) !== -1) : (s2.indexOf(needle2) !== -1);
      push('Memory text "' + k2 + '"' + (ok6 ? ' included "' : ' did not include "') + needle2 + '".');
      out.ok = ok6;

    } else if (t === "derivedNumberComparison") {
      var dk = String(node.derivedKey || "");
      var op4 = node.op || ">=";
      var thr4 = (typeof node.threshold === "number") ? node.threshold : (parseFloat(node.threshold) || 0);
      var dv = Number((env.derived && env.derived[dk]) || 0);
      var ok7 = thCompare(op4, dv, thr4);
      push('Derived "' + dk + '" was ' + dv + ' (needs ' + op4 + ' ' + thr4 + ').');
      out.ok = ok7;

    } else if (t === "randomChance") {
      var thr5 = (typeof node.threshold === "number") ? node.threshold : (parseFloat(node.threshold) || 0);
      var roll = Math.random() * 100;
      var ok8 = (roll < thr5);
      push('Random roll was ' + roll.toFixed(2) + '% (needs < ' + thr5 + '%).');
      out.ok = ok8;

    } else {
      push("Condition type '" + t + "' was treated as always true.");
      out.ok = true;
    }

    if (node.not) {
      var before = out.ok;
      out.ok = !out.ok;
      out.lines.push("Gate " + gateNo + " -> NOT applied (" + (before ? "pass" : "fail") + " becomes " + (out.ok ? "pass" : "fail") + ").");
    }

    return out;
  }

  function thExplainNode(node, env, counter) {
    if (!node) return { ok: true, lines: [] };

    // FIX: support both .items (editor/runtime) and legacy .children
    if (node.nodeType === "group" || node.kind === "group") {
      var join = (String(node.join || "and").toLowerCase() === "or") ? "or" : "and";
      var kids = node.items || node.children || [];
      var i;
      var allLines = [];
      var results = [];

      for (i = 0; i < kids.length; i++) {
        var r = thExplainNode(kids[i], env, counter);
        var j;
        for (j = 0; j < r.lines.length; j++) allLines.push(r.lines[j]);
        results.push(!!r.ok);
      }

      var ok;
      if (!kids.length) {
        ok = true;
        allLines.push("Group " + (join === "or" ? "OR" : "AND") + " -> (no gates) Result: PASSED.");
      } else if (join === "or") {
        ok = false;
        for (i = 0; i < results.length; i++) if (results[i]) { ok = true; break; }
        allLines.push("Group OR -> Any gate can pass. Result: " + (ok ? "PASSED." : "FAILED (no gates passed)."));
      } else {
        ok = true;
        for (i = 0; i < results.length; i++) if (!results[i]) { ok = false; break; }
        allLines.push("Group AND -> All gates must pass. Result: " + (ok ? "PASSED." : "FAILED (at least one gate failed)."));
      }

      if (node.not) {
        var before2 = ok;
        ok = !ok;
        allLines.push("Group " + (join === "or" ? "OR" : "AND") + " -> NOT applied (" + (before2 ? "pass" : "fail") + " becomes " + (ok ? "pass" : "fail") + ").");
      }

      return { ok: ok, lines: allLines };
    }

    counter.n++;
    return thExplainLeaf(node, env, counter.n);
  }

  function thExplainBlockConditions(block, env) {
    if (!block) return { ok: true, lines: [] };
    if (block.type === "else") return { ok: true, lines: [] };

    var join = (String(block.join || 'AND').toUpperCase() === "OR") ? "or" : "and";
    var conds = block.conditions || [];
    if (!conds.length) return { ok: true, lines: ["(no gates)"] };

    var counter = env._gateCounter || { n: 0 };
    env._gateCounter = counter;

    var all = [];
    var i, ok;

    if (join === "or") {
      ok = false;
      for (i = 0; i < conds.length; i++) {
        var r = thExplainNode(conds[i], env, counter);
        var j;
        for (j = 0; j < r.lines.length; j++) all.push(r.lines[j]);
        if (r.ok) ok = true;
      }
      all.push("Gate Join OR -> Any top-level gate can pass. Result: " + (ok ? "PASSED." : "FAILED."));
    } else {
      ok = true;
      for (i = 0; i < conds.length; i++) {
        var r2 = thExplainNode(conds[i], env, counter);
        var j2;
        for (j2 = 0; j2 < r2.lines.length; j2++) all.push(r2.lines[j2]);
        if (!r2.ok) ok = false;
      }
      all.push("Gate Join AND -> All top-level gates must pass. Result: " + (ok ? "PASSED." : "FAILED."));
    }

    return { ok: ok, lines: all };
  }

  function thComputeDerived(appState, env) {
    var out = {};
    var i;
    for (i = 0; i < appState.derived.length; i++) {
      var d = appState.derived[i];
      if (!d || !d.key) continue;
      var items = thGetListItems(appState, d.listId);
      var win = (typeof d.windowSize === "number") ? d.windowSize : (parseInt(d.windowSize, 10) || 10);
      out[d.key] = thCountMatchesInHistory(env.normHistory, items, win);
    }
    return out;
  }

  function thApplyAction(action, context, ran, appState) {
    if (!action) return;

    var target = action.type || "";
    var text = (action.text != null) ? String(action.text) : "";

    if (target === 'appendPersonality') { target = 'context.character.personality'; }
    else if (target === 'appendScenario') { target = 'context.character.scenario'; }
    else if (target === 'appendExampleDialogs') { target = 'context.character.example_dialogs'; }

    var mode = action.mode || "append";
    var memKey = action.memKey ? String(action.memKey) : "";

    context.character = context.character || {};
    context.character.memory = context.character.memory || {};

    function note(s) { ran.push(s); }

    if (target === "context.character.personality" || target === "context.character.scenario" || target === "context.character.example_dialogs") {
      var field = target.split('.').pop();
      if (mode === "set") context.character[field] = text;
      else {
        var cur = String(context.character[field] || "");
        context.character[field] = cur ? (cur + "\n" + text) : text;
      }
      note(field + " " + mode);

    } else if (target === "memoryNumeric") {
      var n = parseFloat(text);
      if (isNaN(n)) n = 0;
      if (!memKey) memKey = "unnamed";
      if (mode === "set") context.character.memory[memKey] = n;
      else context.character.memory[memKey] = Number(context.character.memory[memKey] || 0) + n;
      note("memoryNumeric[" + memKey + "] " + mode + " " + n);

    } else if (target === "memoryString") {
      if (!memKey) memKey = "unnamed";
      if (mode === "set") context.character.memory[memKey] = text;
      else {
        var curMem = String(context.character.memory[memKey] || "");
        context.character.memory[memKey] = curMem ? (curMem + "\n" + text) : text;
      }
      note("memoryString[" + memKey + "] " + mode);

    } else if (target === "appendRandomFromList") {
      var items = thGetListItems(appState, action.listId);
      if (items && items.length) {
        var idx = Math.floor(Math.random() * items.length);
        var choice = items[idx];
        var tgtRaw = action.target || 'appendPersonality';
        var field2 = (tgtRaw === 'appendScenario') ? 'scenario' : ((tgtRaw === 'appendExampleDialogs') ? 'example_dialogs' : 'personality');

        var cur2 = String(context.character[field2] || "");
        context.character[field2] = cur2 ? (cur2 + "\n" + choice) : choice;
        note(field2 + " append (Random: " + choice.substring(0, 15) + "...)");
      } else {
        note("appendRandomFromList (List not found or empty)");
      }
    }
  }

  // ---------------------------
  // Panel UI
  // ---------------------------
  root.Panels.register({
    id: PANEL_ID,

    mount: function (rootEl, studioState) {
      var data = loadData();

      try {
        var cn = rootEl.className || '';
        if ((' ' + cn + ' ').indexOf(' sbx-panel ') === -1) {
          rootEl.className = (cn ? (cn + ' ') : '') + 'sbx-panel';
        }
      } catch (_e0) { }

      injectCssOnce();

      function $(sel) { return rootEl.querySelector(sel); }

      rootEl.innerHTML =
        '<div class="sbx-head">' +
        '<div class="sbx-title">JanitorAI ScriptBuilder X</div>' +
        '<div class="sbx-sub">Phase 1: build Lists / Derived / Trigger Blocks. Import Basic output read-only for reference and future refinement.</div>' +
        '<div class="sbx-row sbx-row-top">' +
        '<div class="sbx-row-l">' +
        '<button class="btn ' + (data.ui.viewMode !== 'test' ? 'btn-primary' : 'btn-ghost') + '" type="button" id="sbx-tab-editor">Editor</button>' +
        '<button class="btn ' + (data.ui.viewMode === 'test' ? 'btn-primary' : 'btn-ghost') + '" type="button" id="sbx-tab-test">Test Harness</button>' +
        '</div>' +
        '<div class="sbx-row-r" id="sbx-editor-toolbar" style="display:' + (data.ui.viewMode === 'test' ? 'none' : 'flex') + '">' +
        '<button class="btn" type="button" id="sbx-btn-import">Compiled View</button>' +
        '<button class="btn" type="button" id="sbx-btn-convert-basic">Import Logic (Editable)</button>' +
        '<button class="btn btn-ghost" type="button" id="sbx-btn-generate">Generate Trigger Code</button>' +
        '<button class="btn btn-ghost" type="button" id="sbx-btn-toggle-debug">Toggle Debug</button>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="sbx-layout" id="sbx-view-editor" style="display:' + (data.ui.viewMode === 'test' ? 'none' : 'grid') + '">' +
        '<div class="sbx-col sbx-left">' +

        '<div class="sbx-section" id="sbx-sec-imported">' +
        '<div class="sbx-section-head">' +
        '<div class="sbx-h2">Imported from Basic (read-only)</div>' +
        '<button class="btn btn-ghost" type="button" id="sbx-btn-toggle-imported">Collapse</button>' +
        '</div>' +
        '<div class="sbx-small">This is the current compiled package from Basic. Later, refinements will target these blocks.</div>' +
        '<div class="sbx-section-body" id="sbx-imported-body">' +
        '<div id="sbx-imported-meta" class="sbx-meta"></div>' +
        '<div class="sbx-import-grid">' +
        '<div class="sbx-import-list" id="sbx-import-list"></div>' +
        '<textarea class="inp sbx-ta sbx-ta-mono" id="sbx-import-code" rows="10" readonly></textarea>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="sbx-section">' +
        '<div class="sbx-h2">Lists (words, phrases, numbers)</div>' +
        '<div class="sbx-row">' +
        '<label class="sbx-lab">Existing Lists:' +
        '<select class="inp sbx-sel" id="sbx-existing-lists"></select>' +
        '</label>' +
        '<button class="btn btn-ghost" type="button" id="sbx-btn-new-list">New List</button>' +
        '</div>' +
        '<div class="sbx-row sbx-row-stack">' +
        '<label class="sbx-lab">List Name:<input class="inp" type="text" id="sbx-list-name" placeholder="e.g. affectionWords"></label>' +
        '<label class="sbx-lab">List Description (optional):<textarea class="inp sbx-ta" id="sbx-list-desc" rows="2" placeholder="What is this list used for?"></textarea></label>' +
        '<label class="sbx-lab">Items (one per line):<textarea class="inp sbx-ta sbx-ta-mono" id="sbx-list-items" rows="5" placeholder="love you&#10;like you&#10;crush on you"></textarea></label>' +
        '</div>' +
        '<div class="sbx-row">' +
        '<button class="btn" type="button" id="sbx-btn-save-list">Save / Update List</button>' +
        '</div>' +
        '<div class="sbx-h3">Preview: All Lists</div>' +
        '<div id="sbx-lists-display" class="sbx-card"></div>' +
        '</div>' +

        '<div class="sbx-section">' +
        '<div class="sbx-h2">Derived Values (from history)</div>' +
        '<div class="sbx-small">Derived values are recomputed every run from <code>context.chat.last_messages</code>.</div>' +
        '<div id="sbx-derived-container"></div>' +
        '<div class="sbx-row">' +
        '<button class="btn btn-ghost" type="button" id="sbx-btn-add-derived">Add Derived Value</button>' +
        '</div>' +
        '</div>' +

        '<div class="sbx-section">' +
        '<div class="sbx-h2">Trigger Blocks (IF / ELSEIF / ELSE chains)</div>' +
        '<div class="sbx-small">Each IF starts a chain. You can add ELSE IF and optional ELSE.</div>' +
        '<div class="sbx-row">' +
        '<button class="btn btn-ghost" type="button" id="sbx-btn-add-if">Add IF Block</button>' +
        '<button class="btn btn-ghost" type="button" id="sbx-btn-add-elseif">Add ELSE IF Block</button>' +
        '<button class="btn btn-ghost" type="button" id="sbx-btn-add-else">Add ELSE Block</button>' +
        '</div>' +
        '<div id="sbx-blocks-container"></div>' +
        '</div>' +

        '</div>' +

        '<div class="sbx-col sbx-right">' +
        '<div class="sbx-section">' +
        '<div class="sbx-h2">Generated JanitorAI Trigger Code</div>' +
        '<div class="sbx-small">Copy-paste into Advanced Script. Uses <code>context</code>.</div>' +
        '<div class="sbx-row">' +
        '<button class="btn btn-ghost" type="button" id="sbx-btn-copy">Copy</button>' +
        '</div>' +
        '<textarea class="inp sbx-ta sbx-ta-mono" id="sbx-generated" rows="22" readonly></textarea>' +
        '</div>' +

        '<div class="sbx-section" id="sbx-sec-debug">' +
        '<div class="sbx-section-head">' +
        '<div class="sbx-h2">Debug: Current Config</div>' +
        '</div>' +
        '<div class="sbx-small">Derived summaries and raw JSON.</div>' +
        '<textarea class="inp sbx-ta sbx-ta-mono" id="sbx-debug" rows="18" readonly></textarea>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="sbx-layout" id="sbx-view-test" style="display:' + (data.ui.viewMode === 'test' ? 'grid' : 'none') + '">' +
        '<div class="sbx-col sbx-left">' +
        '<div class="sbx-section">' +
        '<div class="sbx-h2">Test Context Inputs</div>' +
        '<div class="sbx-small">Simulate the JS environment.</div>' +
        '<div class="sbx-row sbx-row-stack">' +
        '<label class="sbx-lab">Personality (current):<textarea class="inp sbx-ta" id="sbx-th-personality" rows="3"></textarea></label>' +
        '<label class="sbx-lab">Scenario (current):<textarea class="inp sbx-ta" id="sbx-th-scenario" rows="3"></textarea></label>' +
        '</div>' +
        '<div class="sbx-h3">Chat History (Last Messages)</div>' +
        '<div id="sbx-th-messages" class="sbx-card"></div>' +
        '<div class="sbx-row">' +
        '<button class="btn" type="button" id="sbx-th-add-msg">Add Message</button>' +
        '<button class="btn btn-ghost" type="button" id="sbx-th-reset-all">Reset Inputs</button>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="sbx-col sbx-right">' +
        '<div class="sbx-section">' +
        '<div class="sbx-h2">Test Evaluation</div>' +
        '<div class="sbx-row">' +
        '<button class="btn btn-primary" type="button" id="sbx-th-run">Run Test</button>' +
        '</div>' +
        '<div class="sbx-h3">Results & Log</div>' +
        '<pre class="sbx-pre" id="sbx-th-results" style="min-height:300px;background:#111;padding:10px;"></pre>' +
        '</div>' +
        '</div>' +
        '</div>';

      // ---------------------------
      // UI wiring
      // ---------------------------
      function refreshImportedUI() {
        var meta = $('#sbx-imported-meta');
        var listHost = $('#sbx-import-list');
        var codeTa = $('#sbx-import-code');

        if (!meta || !listHost || !codeTa) return;

        var blocks = data.imported.blocks || [];
        var selKey = data.ui.selectedImportedKey;

        meta.innerHTML = '';
        if (!blocks.length) {
          meta.innerHTML = '<div class="sbx-muted">No imported blocks yet. Click "Compiled View".</div>';
          listHost.innerHTML = '';
          codeTa.value = '';
          return;
        }

        var order = (data.imported.pkg && data.imported.pkg.buildOrder && isArr(data.imported.pkg.buildOrder))
          ? data.imported.pkg.buildOrder.join(' -> ')
          : '(unknown)';

        meta.innerHTML =
          '<span class="sbx-chip">Blocks: ' + blocks.length + '</span>' +
          '<span class="sbx-chip">Build order: ' + esc(order) + '</span>';

        var html = '';
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          var active = (b.key === selKey);
          html +=
            '<button type="button" class="sbx-item' + (active ? ' is-active' : '') + '" data-key="' + esc(b.key) + '">' +
            '<div class="sbx-item-top">' + esc(b.moduleId) + '</div>' +
            '<div class="sbx-item-sub">' + esc(b.id) + ' <span class="sbx-tag">' + esc(b.kind) + '</span></div>' +
            '</button>';
        }
        listHost.innerHTML = html;

        var btns = listHost.getElementsByTagName('button');
        for (var j = 0; j < btns.length; j++) {
          btns[j].onclick = function () {
            var k = this.getAttribute('data-key');
            data.ui.selectedImportedKey = k;
            saveData();
            refreshImportedUI();
          };
        }

        var found = null;
        for (i = 0; i < blocks.length; i++) {
          if (blocks[i].key === selKey) { found = blocks[i]; break; }
        }
        if (!found) found = blocks[0];
        data.ui.selectedImportedKey = found ? found.key : null;
        codeTa.value = found ? String(found.code || '') : '';
      }

      function refreshListsSelect() {
        var sel = $('#sbx-existing-lists');
        if (!sel) return;

        sel.innerHTML = '';
        var opt0 = document.createElement('option');
        opt0.value = '';
        opt0.appendChild(document.createTextNode('-- None --'));
        sel.appendChild(opt0);

        var lists = data.appState.lists || [];
        for (var i = 0; i < lists.length; i++) {
          var l = lists[i];
          if (!l || !l.id) continue;
          var o = document.createElement('option');
          o.value = l.id;
          o.appendChild(document.createTextNode(l.label ? (l.label + ' (' + l.id + ')') : l.id));
          sel.appendChild(o);
        }
      }

      function refreshListsPreview() {
        var host = $('#sbx-lists-display');
        if (!host) return;

        var lists = data.appState.lists || [];
        if (!lists.length) {
          host.innerHTML = '<div class="sbx-muted">(no lists)</div>';
          return;
        }

        var html = '';
        for (var i = 0; i < lists.length; i++) {
          var l = lists[i] || {};
          html += '<div class="sbx-listcard">';
          html += '<div class="sbx-listcard-h">' + esc(l.label || l.id || '(unnamed)') + '</div>';
          if (l.description) html += '<div class="sbx-muted">' + esc(l.description) + '</div>';
          var items = isArr(l.items) ? l.items : [];
          html += '<div class="sbx-muted">Items: ' + items.length + '</div>';
          html += '</div>';
        }
        host.innerHTML = html;
      }

      function refreshDerivedUI() {
        var host = $('#sbx-derived-container');
        if (!host) return;

        var derived = data.appState.derived || [];
        var lists = data.appState.lists || [];

        if (!derived.length) {
          host.innerHTML = '<div class="sbx-muted">(no derived values)</div>';
          return;
        }

        var html = '';
        for (var i = 0; i < derived.length; i++) {
          var d = derived[i] || {};
          var key = esc(String(d.key || ''));
          var desc = esc(String(d.description || ''));
          var ws = (d.windowSize == null) ? '' : esc(String(d.windowSize));

          html +=
            '<div class="sbx-rowcard" data-idx="' + i + '">' +
            '<div class="sbx-row sbx-row-tight">' +
            '<label class="sbx-lab">Key <input class="inp sbx-der-key" type="text" value="' + key + '"></label>' +
            '<label class="sbx-lab">Window <input class="inp sbx-der-ws" type="number" min="1" step="1" value="' + ws + '"></label>' +
            '<button class="btn btn-ghost sbx-der-del" type="button">Remove</button>' +
            '</div>' +
            '<div class="sbx-row sbx-row-tight">' +
            '<label class="sbx-lab">List ' +
            '<select class="inp sbx-der-list"></select>' +
            '</label>' +
            '</div>' +
            '<div class="sbx-row sbx-row-tight">' +
            '<label class="sbx-lab">Description <input class="inp sbx-der-desc" type="text" value="' + desc + '"></label>' +
            '</div>' +
            '</div>';
        }

        host.innerHTML = html;

        var cards = host.getElementsByClassName('sbx-rowcard');
        for (var c = 0; c < cards.length; c++) {
          (function () {
            var card = cards[c];
            var idx = parseInt(card.getAttribute('data-idx'), 10);
            if (isNaN(idx)) return;

            var sel = card.getElementsByClassName('sbx-der-list')[0];
            if (sel) {
              sel.innerHTML = '';
              var o0 = document.createElement('option');
              o0.value = '';
              o0.appendChild(document.createTextNode('-- choose list --'));
              sel.appendChild(o0);

              for (var li = 0; li < lists.length; li++) {
                var l = lists[li];
                if (!l || !l.id) continue;
                var o = document.createElement('option');
                o.value = l.id;
                o.appendChild(document.createTextNode(l.label ? (l.label + ' (' + l.id + ')') : l.id));
                sel.appendChild(o);
              }
              sel.value = String((data.appState.derived[idx] && data.appState.derived[idx].listId) || '');
              sel.onchange = function () {
                data.appState.derived[idx].listId = String(sel.value || '');
                saveData();
                refreshDebug();
              };
            }

            var keyIn = card.getElementsByClassName('sbx-der-key')[0];
            var wsIn = card.getElementsByClassName('sbx-der-ws')[0];
            var descIn = card.getElementsByClassName('sbx-der-desc')[0];
            var delBtn = card.getElementsByClassName('sbx-der-del')[0];

            if (keyIn) keyIn.oninput = function () { data.appState.derived[idx].key = String(keyIn.value || ''); saveData(); refreshDebug(); };
            if (wsIn) wsIn.oninput = function () {
              var v = parseInt(wsIn.value, 10);
              if (isNaN(v) || v <= 0) v = 10;
              data.appState.derived[idx].windowSize = v;
              saveData();
              refreshDebug();
            };
            if (descIn) descIn.oninput = function () { data.appState.derived[idx].description = String(descIn.value || ''); saveData(); refreshDebug(); };

            if (delBtn) delBtn.onclick = function () {
              data.appState.derived.splice(idx, 1);
              saveData();
              refreshDerivedUI();
              refreshDebug();
            };
          })();
        }
      }

      // ---------------------------
      // Conditions + Actions renderers
      // ---------------------------
      function renderConditions(host2, blockIdx) {
        var b2 = data.appState.blocks[blockIdx];
        var rootNodes = (b2 && isArr(b2.conditions)) ? b2.conditions : [];
        var lists = data.appState.lists || [];
        var derived = data.appState.derived || [];

        if (b2 && b2.type === 'else') {
          host2.innerHTML = '<div class="sbx-muted">(ELSE has no conditions)</div>';
          return;
        }

        function isGroup(n) { return n && (n.nodeType === 'group' || n.kind === 'group'); }
        function normJoin(j) { j = String(j || 'and').toLowerCase(); return (j === 'or') ? 'or' : 'and'; }

        function getNodeByPath(nodes, path) {
          if (!path) return null;
          var parts = String(path).split('.');
          var cur = { items: nodes };
          var i, idx;
          for (i = 0; i < parts.length; i++) {
            idx = parseInt(parts[i], 10);
            if (isNaN(idx) || !cur.items || !cur.items[idx]) return null;
            cur = cur.items[idx];
            if (i < parts.length - 1) {
              if (!isGroup(cur)) return null;
            }
          }
          return cur;
        }

        function getParentByPath(nodes, path) {
          if (!path) return null;
          var parts = String(path).split('.');
          if (parts.length === 1) {
            return { parentItems: nodes, index: parseInt(parts[0], 10) };
          }
          var parentPath = parts.slice(0, parts.length - 1).join('.');
          var parentNode = getNodeByPath(nodes, parentPath);
          if (!parentNode || !isGroup(parentNode)) return null;
          return { parentItems: parentNode.items || [], index: parseInt(parts[parts.length - 1], 10), parentNode: parentNode };
        }

        function escAttr(s) { return esc(s || ''); }

        function renderLeaf(c, path) {
          var t = String(c.type || 'historyContainsList');
          var html2 = '';
          html2 += '<div class="sbx-rowcard" data-path="' + escAttr(path) + '">';
          html2 += '<div class="sbx-row sbx-row-tight">';
          html2 += '<label class="sbx-lab">Type ';
          html2 += '<select class="inp sbx-cond-type">';
          var types = [
            ['countInHistory', 'Count matches in History'],
            ['anyInList', 'Any list item exists'],
            ['noneInList', 'No list items exist'],
            ['messageCountComparison', 'Total Message Count'],
            ['personalityContains', 'Personality Contains Text'],
            ['scenarioContains', 'Scenario Contains Text'],
            ['messageHistoryContains', 'History Contains Text'],
            ['memoryNumberComparison', 'Memory (Number) check'],
            ['memoryStringContains', 'Memory (String) check'],
            ['derivedNumberComparison', 'Derived Value check'],
            ['randomChance', 'Random Chance %'],
            ['historyContainsList', '(Legacy) History Contains List']
          ];
          var k;
          for (k = 0; k < types.length; k++) {
            html2 += '<option value="' + types[k][0] + '"' + (t === types[k][0] ? ' selected' : '') + '>' + types[k][1] + '</option>';
          }
          html2 += '</select></label>';

          html2 += '<label class="sbx-lab" style="margin-left:8px"><input type="checkbox" class="sbx-cond-not"' + (c.not ? ' checked' : '') + '> NOT</label>';

          html2 += '<button class="btn btn-ghost sbx-cond-del" type="button">Remove</button></div>';

          html2 += '<div class="sbx-row sbx-row-tight sbx-cond-details">';

          if (t === 'anyInList' || t === 'noneInList' || t === 'countInHistory' || t === 'historyContainsList') {
            html2 += '<label class="sbx-lab">List <select class="inp sbx-cond-list"><option value="">-- choose --</option>';
            for (var L = 0; L < lists.length; L++) {
              var l = lists[L];
              var sel = (l.id === c.listId) ? ' selected' : '';
              html2 += '<option value="' + escAttr(l.id) + '"' + sel + '>' + esc(l.label || l.id) + '</option>';
            }
            html2 += '</select></label>';
            html2 += '<label class="sbx-lab">Source <select class="inp sbx-cond-src">';
            var src = (c.source === 'normHistory') ? 'normHistory' : 'lastUserMsg';
            html2 += '<option value="lastUserMsg"' + (src === 'lastUserMsg' ? ' selected' : '') + '>Last user msg</option>';
            html2 += '<option value="normHistory"' + (src === 'normHistory' ? ' selected' : '') + '>History window</option>';
            html2 += '</select></label>';
            if (t === 'anyInList') {
              html2 += '<label class="sbx-lab" style="margin-top:4px"><input type="checkbox" class="sbx-cond-neg"' + (c.negationGuard ? ' checked' : '') + '> Negation Guard</label>';
            }
          }

          if (t === 'countInHistory' || t === 'historyContainsList' || t === 'messageHistoryContains') {
            html2 += '<label class="sbx-lab">Window <input class="inp sbx-cond-ws" type="number" min="1" value="' + (c.windowSize || 5) + '"></label>';
          }

          var needsOp = (t === 'countInHistory' || t === 'historyContainsList' || t === 'messageCountComparison' || t === 'memoryNumberComparison' || t === 'derivedNumberComparison');
          var needsTh = needsOp || (t === 'randomChance');
          if (needsOp || needsTh) {
            if (needsOp) {
              var op = String(c.op || '>=');
              html2 += '<label class="sbx-lab">Op <select class="inp sbx-cond-op">';
              var ops = ['>=', '>', '==', '<=', '<', '!=', 'every'];
              for (var o = 0; o < ops.length; o++) html2 += '<option value="' + ops[o] + '"' + (op === ops[o] ? ' selected' : '') + '>' + ops[o] + '</option>';
              html2 += '</select></label>';
            }
            html2 += '<label class="sbx-lab">Thresh <input class="inp sbx-cond-th" type="number" value="' + (c.threshold || 0) + '"></label>';
          }

          if (t === 'personalityContains' || t === 'scenarioContains' || t === 'messageHistoryContains' || t === 'memoryStringContains') {
            html2 += '<label class="sbx-lab">Text <input class="inp sbx-cond-text" type="text" value="' + escAttr(c.text || '') + '"></label>';
          }

          if (t === 'memoryNumberComparison' || t === 'memoryStringContains') {
            html2 += '<label class="sbx-lab">MemKey <input class="inp sbx-cond-memkey" type="text" value="' + escAttr(c.memKey || '') + '"></label>';
          }

          if (t === 'derivedNumberComparison') {
            html2 += '<label class="sbx-lab">Derived <select class="inp sbx-cond-derived"><option value="">-- choose --</option>';
            for (var D = 0; D < derived.length; D++) {
              var dd = derived[D];
              var dsel = (dd.key === c.derivedKey) ? ' selected' : '';
              html2 += '<option value="' + escAttr(dd.key) + '"' + dsel + '>' + esc(dd.key) + '</option>';
            }
            html2 += '</select></label>';
          }

          html2 += '</div></div>';
          return html2;
        }

        function renderGroup(g, path) {
          var j = normJoin(g.join);
          var html2 = '';
          html2 += '<div class="sbx-group" data-path="' + escAttr(path) + '">';
          html2 += '<div class="sbx-row sbx-row-tight sbx-group-hdr">';
          html2 += '<strong>Group</strong>';
          html2 += '<label class="sbx-lab" style="margin-left:8px">Join <select class="inp sbx-group-join">';
          html2 += '<option value="and"' + (j === 'and' ? ' selected' : '') + '>AND</option>';
          html2 += '<option value="or"' + (j === 'or' ? ' selected' : '') + '>OR</option>';
          html2 += '</select></label>';
          html2 += '<label class="sbx-lab" style="margin-left:8px"><input type="checkbox" class="sbx-group-not"' + (g.not ? ' checked' : '') + '> NOT group</label>';
          html2 += '<button class="btn btn-ghost sbx-group-del" type="button">Remove Group</button>';
          html2 += '</div>';

          html2 += '<div class="sbx-group-children">';
          var items = isArr(g.items) ? g.items : (g.items = []);
          if (!items.length) {
            html2 += '<div class="sbx-muted">(empty group)</div>';
          } else {
            for (var i = 0; i < items.length; i++) {
              var childPath = path ? (path + '.' + i) : String(i);
              html2 += renderNode(items[i], childPath);
            }
          }
          html2 += '</div>';

          html2 += '<div class="sbx-row sbx-row-tight">';
          html2 += '<button class="btn btn-ghost sbx-cond-add-sub" type="button" data-parent-path="' + escAttr(path) + '">Add Condition</button>';
          html2 += '<button class="btn btn-ghost sbx-group-add-sub" type="button" data-parent-path="' + escAttr(path) + '">Add Subgroup</button>';
          html2 += '</div>';

          html2 += '</div>';
          return html2;
        }

        function renderNode(n, path) {
          if (isGroup(n)) return renderGroup(n, path);
          return renderLeaf(n || {}, path);
        }

        var html = '';
        if (!rootNodes.length) {
          html = '<div class="sbx-muted">(no conditions)</div>';
        } else {
          for (var i2 = 0; i2 < rootNodes.length; i2++) {
            html += renderNode(rootNodes[i2], String(i2));
          }
        }
        host2.innerHTML = html;

        function bindInput(row, cls, fn) {
          var el = row.getElementsByClassName(cls)[0];
          if (!el) return;
          el.onchange = fn;
          if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'number')) el.oninput = fn;
          if (el.tagName === 'TEXTAREA') el.oninput = fn;
        }

        var leafRows = host2.getElementsByClassName('sbx-rowcard');
        for (var r = 0; r < leafRows.length; r++) {
          (function () {
            var row = leafRows[r];
            var path = row.getAttribute('data-path') || '';
            var node = getNodeByPath(rootNodes, path);
            if (!node) return;

            function changed(soft) {
              saveData();
              refreshDebug();
              if (!soft) refreshGenerated();
            }

            var typeSel = row.getElementsByClassName('sbx-cond-type')[0];
            if (typeSel) typeSel.onchange = function () { node.type = typeSel.value; changed(); refreshBlocksUI(); };

            var notChk = row.getElementsByClassName('sbx-cond-not')[0];
            if (notChk) notChk.onchange = function () { node.not = !!notChk.checked; changed(true); };

            bindInput(row, 'sbx-cond-list', function () {
              var el = row.getElementsByClassName('sbx-cond-list')[0];
              if (el) { node.listId = el.value; changed(); }
            });
            bindInput(row, 'sbx-cond-src', function () {
              var el = row.getElementsByClassName('sbx-cond-src')[0];
              if (el) { node.source = (el.value === 'normHistory' ? 'normHistory' : 'lastUserMsg'); changed(true); }
            });
            var chkNeg = row.getElementsByClassName('sbx-cond-neg')[0];
            if (chkNeg) chkNeg.onchange = function () { node.negationGuard = !!chkNeg.checked; changed(true); };

            bindInput(row, 'sbx-cond-ws', function () {
              var el = row.getElementsByClassName('sbx-cond-ws')[0];
              if (el) { node.windowSize = parseInt(el.value, 10) || 1; changed(true); }
            });
            bindInput(row, 'sbx-cond-op', function () {
              var el = row.getElementsByClassName('sbx-cond-op')[0];
              if (el) { node.op = el.value; changed(true); }
            });
            bindInput(row, 'sbx-cond-th', function () {
              var el = row.getElementsByClassName('sbx-cond-th')[0];
              if (el) { node.threshold = parseFloat(el.value); if (isNaN(node.threshold)) node.threshold = 0; changed(true); }
            });
            bindInput(row, 'sbx-cond-text', function () {
              var el = row.getElementsByClassName('sbx-cond-text')[0];
              if (el) { node.text = el.value; changed(true); }
            });
            bindInput(row, 'sbx-cond-memkey', function () {
              var el = row.getElementsByClassName('sbx-cond-memkey')[0];
              if (el) { node.memKey = el.value; changed(true); }
            });
            bindInput(row, 'sbx-cond-derived', function () {
              var el = row.getElementsByClassName('sbx-cond-derived')[0];
              if (el) { node.derivedKey = el.value; changed(true); }
            });

            var del = row.getElementsByClassName('sbx-cond-del')[0];
            if (del) del.onclick = function () {
              var p = getParentByPath(rootNodes, path);
              if (!p || !p.parentItems) return;
              if (p.index >= 0 && p.index < p.parentItems.length) p.parentItems.splice(p.index, 1);
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };
          })();
        }

        var groupBoxes = host2.getElementsByClassName('sbx-group');
        for (var g = 0; g < groupBoxes.length; g++) {
          (function () {
            var box = groupBoxes[g];
            var path = box.getAttribute('data-path') || '';
            var node = getNodeByPath(rootNodes, path);
            if (!node) return;
            if (!node.items) node.items = [];

            var joinSel = box.getElementsByClassName('sbx-group-join')[0];
            if (joinSel) joinSel.onchange = function () { node.join = joinSel.value; saveData(); refreshDebug(); refreshGenerated(); };

            var notChk = box.getElementsByClassName('sbx-group-not')[0];
            if (notChk) notChk.onchange = function () { node.not = !!notChk.checked; saveData(); refreshDebug(); refreshGenerated(); };

            var del = box.getElementsByClassName('sbx-group-del')[0];
            if (del) del.onclick = function () {
              var p = getParentByPath(rootNodes, path);
              if (!p || !p.parentItems) return;
              if (p.index >= 0 && p.index < p.parentItems.length) p.parentItems.splice(p.index, 1);
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };
          })();
        }

        var addSubCond = host2.getElementsByClassName('sbx-cond-add-sub');
        for (var a = 0; a < addSubCond.length; a++) {
          (function () {
            var btn = addSubCond[a];
            var ppath = btn.getAttribute('data-parent-path') || '';
            btn.onclick = function () {
              var parent = getNodeByPath(rootNodes, ppath);
              if (!parent || !(parent.nodeType === 'group' || parent.kind === 'group')) return;
              parent.items = parent.items || [];
              parent.items.push(makeDefaultCondition());
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };
          })();
        }

        var addSubGroup = host2.getElementsByClassName('sbx-group-add-sub');
        for (var a2 = 0; a2 < addSubGroup.length; a2++) {
          (function () {
            var btn = addSubGroup[a2];
            var ppath = btn.getAttribute('data-parent-path') || '';
            btn.onclick = function () {
              var parent = getNodeByPath(rootNodes, ppath);
              if (!parent || !(parent.nodeType === 'group' || parent.kind === 'group')) return;
              parent.items = parent.items || [];
              parent.items.push(makeDefaultGroup());
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };
          })();
        }
      }

      function renderActions(host2, blockIdx) {
        var b2 = data.appState.blocks[blockIdx];
        var acts = (b2 && isArr(b2.actions)) ? b2.actions : [];

        if (!acts.length) {
          host2.innerHTML = '<div class="sbx-muted">(no actions)</div>';
          return;
        }

        var html2 = '';
        for (var i2 = 0; i2 < acts.length; i2++) {
          var a = acts[i2] || {};
          var t = String(a.type || 'appendPersonality');

          html2 +=
            '<div class="sbx-rowcard sbx-rowcard-tight" data-aidx="' + i2 + '">' +
            '<div class="sbx-row sbx-row-tight">' +
            '<label class="sbx-lab">Type ' +
            '<select class="inp sbx-act-type">' +
            '<option value="appendPersonality"' + (t === 'appendPersonality' ? ' selected' : '') + '>Append Personality</option>' +
            '<option value="appendScenario"' + (t === 'appendScenario' ? ' selected' : '') + '>Append Scenario</option>' +
            '<option value="appendExampleDialogs"' + (t === 'appendExampleDialogs' ? ' selected' : '') + '>Append Example Dialogs</option>' +
            '<option value="memoryNumeric"' + (t === 'memoryNumeric' ? ' selected' : '') + '>Memory (Number)</option>' +
            '<option value="memoryString"' + (t === 'memoryString' ? ' selected' : '') + '>Memory (String)</option>' +
            '<option value="appendRandomFromList"' + (t === 'appendRandomFromList' ? ' selected' : '') + '>Append Random from List</option>' +
            '</select>' +
            '</label>' +
            '<button class="btn btn-ghost sbx-act-del" type="button">Remove</button>' +
            '</div>';

          if (t === 'appendRandomFromList') {
            var lists = data.appState.lists || [];
            html2 += '<div class="sbx-row sbx-row-tight">';
            html2 += '<label class="sbx-lab">Target <select class="inp sbx-act-target">' +
              '<option value="appendPersonality"' + (a.target === 'appendPersonality' ? ' selected' : '') + '>Personality</option>' +
              '<option value="appendScenario"' + (a.target === 'appendScenario' ? ' selected' : '') + '>Scenario</option>' +
              '<option value="appendExampleDialogs"' + (a.target === 'appendExampleDialogs' ? ' selected' : '') + '>Example Dialogs</option>' +
              '</select></label>';
            html2 += '<label class="sbx-lab">List <select class="inp sbx-act-list"><option value="">-- choose --</option>';
            for (var L = 0; L < lists.length; L++) {
              var l = lists[L];
              var sel = (l.id === a.listId ? ' selected' : '');
              html2 += '<option value="' + esc(l.id) + '"' + sel + '>' + esc(l.label || l.id) + '</option>';
            }
            html2 += '</select></label>';
            html2 += '</div>';
          }

          if (t === 'memoryNumeric' || t === 'memoryString') {
            html2 += '<div class="sbx-row sbx-row-tight">';
            html2 += '<label class="sbx-lab">Key <input class="inp sbx-act-memkey" type="text" value="' + esc(a.memKey || '') + '"></label>';
            html2 += '<label class="sbx-lab">Mode <select class="inp sbx-act-mode">';
            html2 += '<option value="set"' + (a.mode === 'set' ? ' selected' : '') + '>Set</option>';
            html2 += '<option value="append"' + (a.mode === 'append' ? ' selected' : '') + '>Append/Add</option>';
            html2 += '</select></label>';
            html2 += '</div>';
          }

          html2 += '<div class="sbx-row sbx-row-tight">' +
            '<label class="sbx-lab">Text/Val ' +
            '<textarea class="inp sbx-ta sbx-ta-mono sbx-act-text" rows="2">' + esc(a.text || '') + '</textarea>' +
            '</label>' +
            '</div>' +
            '</div>';
        }
        host2.innerHTML = html2;

        var rows = host2.getElementsByClassName('sbx-rowcard');
        for (var r = 0; r < rows.length; r++) {
          (function () {
            var row = rows[r];
            var aidx = parseInt(row.getAttribute('data-aidx'), 10);
            var act = b2.actions[aidx];

            function bind(cls, key) {
              var el = row.getElementsByClassName(cls)[0];
              if (!el) return;
              if (el.tagName === 'SELECT') el.onchange = function () { act[key] = el.value; saveData(); refreshDebug(); refreshGenerated(); if (cls === 'sbx-act-type') refreshBlocksUI(); };
              else el.oninput = function () { act[key] = el.value; saveData(); refreshDebug(); refreshGenerated(); };
            }
            bind('sbx-act-type', 'type');
            bind('sbx-act-memkey', 'memKey');
            bind('sbx-act-mode', 'mode');
            bind('sbx-act-text', 'text');
            bind('sbx-act-target', 'target');
            bind('sbx-act-list', 'listId');

            var delBtn = row.getElementsByClassName('sbx-act-del')[0];
            if (delBtn) delBtn.onclick = function () {
              b2.actions.splice(aidx, 1);
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };
          })();
        }
      }

      function refreshBlocksUI() {
        var host = $('#sbx-blocks-container');
        if (!host) return;

        var blocks = data.appState.blocks || [];
        if (!blocks.length) {
          host.innerHTML = '<div class="sbx-muted">(no trigger blocks)</div>';
          return;
        }

        var groups = {};
        var sortOrder = [];
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          var gid = b.groupId || 'Ungrouped';
          if (!groups[gid]) { groups[gid] = []; sortOrder.push(gid); }
          groups[gid].push({ b: b, i: i });
        }

        var html = '';
        for (var g = 0; g < sortOrder.length; g++) {
          var gid2 = sortOrder[g];
          var gitems = groups[gid2];

          if (gid2 !== 'Ungrouped' || sortOrder.length > 1) {
            html += '<div class="sbx-group" style="margin-bottom:10px; border:1px solid #444; border-radius:8px; overflow:hidden;">' +
              '<div class="sbx-group-head" style="padding:8px; background:rgba(255,255,255,0.05); cursor:pointer; font-weight:bold; display:flex; justify-content:space-between;">' +
              '<span class="sbx-group-title">' + esc(gid2) + ' (' + gitems.length + ')</span>' +
              '<span class="sbx-group-icon">v</span>' +
              '</div>' +
              '<div class="sbx-group-body" style="padding:8px;">';
          }

          for (var k = 0; k < gitems.length; k++) {
            var item = gitems[k];
            var idx = item.i;
            var bb = item.b;
            var type = esc(String(bb.type || 'if').toUpperCase());
            var label = esc(String(bb.label || ''));
            var desc = esc(String(bb.description || ''));
            var join = (String(bb.join || 'AND').toUpperCase() === 'OR') ? 'OR' : 'AND';

            html +=
              '<div class="sbx-block" data-idx="' + idx + '">' +
              '<div class="sbx-block-head">' +
              '<span class="sbx-chip sbx-chip-strong">' + type + '</span>' +
              '<button class="btn btn-ghost sbx-blk-up" type="button">^</button>' +
              '<button class="btn btn-ghost sbx-blk-dn" type="button">v</button>' +
              '<button class="btn btn-ghost sbx-blk-del" type="button">Remove</button>' +
              '</div>' +
              '<div class="sbx-row sbx-row-tight">' +
              '<label class="sbx-lab">Label <input class="inp sbx-blk-label" type="text" value="' + label + '"></label>' +
              '</div>' +
              '<div class="sbx-row sbx-row-tight">' +
              '<label class="sbx-lab">Description <input class="inp sbx-blk-desc" type="text" value="' + desc + '"></label>' +
              '</div>' +

              '<div class="sbx-row sbx-row-tight">' +
              '<label class="sbx-lab">Condition Join ' +
              '<select class="inp sbx-blk-join">' +
              '<option value="AND"' + (join === 'AND' ? ' selected' : '') + '>AND</option>' +
              '<option value="OR"' + (join === 'OR' ? ' selected' : '') + '>OR</option>' +
              '</select>' +
              '</label>' +
              '</div>' +

              '<div class="sbx-h3">Conditions</div>' +
              '<div class="sbx-conds"></div>' +
              '<div class="sbx-row sbx-row-tight">' +
              '<button class="btn btn-ghost sbx-cond-add" type="button">Add Condition</button>' +
              '<button class="btn btn-ghost sbx-group-add" type="button">Add Group</button>' +
              '</div>' +

              '<div class="sbx-h3">Actions</div>' +
              '<div class="sbx-acts"></div>' +
              '<div class="sbx-row sbx-row-tight">' +
              '<button class="btn btn-ghost sbx-act-add" type="button">Add Action</button>' +
              '</div>' +
              '</div>';
          }

          if (gid2 !== 'Ungrouped' || sortOrder.length > 1) {
            html += '</div></div>';
          }
        }

        host.innerHTML = html;

        var grpHeads = host.getElementsByClassName('sbx-group-head');
        for (var gh = 0; gh < grpHeads.length; gh++) {
          grpHeads[gh].onclick = function () {
            var body = this.nextElementSibling;
            var icon = this.getElementsByClassName('sbx-group-icon')[0];
            if (body && body.style.display === 'none') {
              body.style.display = 'block';
              if (icon) icon.textContent = 'v';
            } else if (body) {
              body.style.display = 'none';
              if (icon) icon.textContent = '>';
            }
          };
        }

        var cards = host.getElementsByClassName('sbx-block');
        for (var c = 0; c < cards.length; c++) {
          (function () {
            var card = cards[c];
            var idx = parseInt(card.getAttribute('data-idx'), 10);
            if (isNaN(idx)) return;

            var b = data.appState.blocks[idx];

            var up = card.getElementsByClassName('sbx-blk-up')[0];
            var dn = card.getElementsByClassName('sbx-blk-dn')[0];
            var del = card.getElementsByClassName('sbx-blk-del')[0];

            if (up) up.onclick = function () {
              if (idx <= 0) return;
              var tmp = data.appState.blocks[idx - 1];
              data.appState.blocks[idx - 1] = data.appState.blocks[idx];
              data.appState.blocks[idx] = tmp;
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };
            if (dn) dn.onclick = function () {
              if (idx >= data.appState.blocks.length - 1) return;
              var tmp2 = data.appState.blocks[idx + 1];
              data.appState.blocks[idx + 1] = data.appState.blocks[idx];
              data.appState.blocks[idx] = tmp2;
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };
            if (del) del.onclick = function () {
              data.appState.blocks.splice(idx, 1);
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };

            var lblIn = card.getElementsByClassName('sbx-blk-label')[0];
            var descIn = card.getElementsByClassName('sbx-blk-desc')[0];
            var joinSel = card.getElementsByClassName('sbx-blk-join')[0];

            if (lblIn) lblIn.oninput = function () { b.label = String(lblIn.value || ''); saveData(); refreshDebug(); refreshGenerated(); };
            if (descIn) descIn.oninput = function () { b.description = String(descIn.value || ''); saveData(); refreshDebug(); refreshGenerated(); };
            if (joinSel) joinSel.onchange = function () { b.join = String(joinSel.value || 'AND'); saveData(); refreshDebug(); refreshGenerated(); };

            var condHost = card.getElementsByClassName('sbx-conds')[0];
            if (condHost) renderConditions(condHost, idx);

            var addCond = card.getElementsByClassName('sbx-cond-add')[0];
            if (addCond) addCond.onclick = function () {
              b.conditions = b.conditions || [];
              b.conditions.push(makeDefaultCondition());
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };

            var addGroup = card.getElementsByClassName('sbx-group-add')[0];
            if (addGroup) addGroup.onclick = function () {
              b.conditions = b.conditions || [];
              b.conditions.push(makeDefaultGroup());
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };

            var actHost = card.getElementsByClassName('sbx-acts')[0];
            if (actHost) renderActions(actHost, idx);

            var addAct = card.getElementsByClassName('sbx-act-add')[0];
            if (addAct) addAct.onclick = function () {
              b.actions = b.actions || [];
              b.actions.push(makeDefaultAction());
              saveData();
              refreshBlocksUI();
              refreshDebug();
              refreshGenerated();
            };
          })();
        }
      }

      function refreshGenerated() {
        var out = $('#sbx-generated');
        if (!out) return;
        out.value = generateCode(data.appState);
        out.scrollTop = 0;
      }

      function refreshDebug() {
        var dbg = $('#sbx-debug');
        if (!dbg) return;

        var snapshot = {
          imported: {
            buildOrder: (data.imported.pkg && data.imported.pkg.buildOrder) ? data.imported.pkg.buildOrder : null,
            blocks: (data.imported.blocks || []).length
          },
          appState: data.appState
        };

        dbg.value = JSON.stringify(snapshot, null, 2);
      }

      function refreshAll() {
        refreshListsSelect();
        refreshListsPreview();
        refreshDerivedUI();
        refreshBlocksUI();
        refreshImportedUI();
        refreshGenerated();
        refreshDebug();
      }

      // ---------------------------
      // Button wiring
      // ---------------------------
      var btnImport = $('#sbx-btn-import');
      if (btnImport) btnImport.onclick = function () {
        var pkg = buildImportedFromBasic(studioState);
        data.imported.pkg = pkg;
        data.imported.blocks = normalizeImportedBlocks(pkg);

        if (!data.ui.selectedImportedKey && data.imported.blocks.length) {
          data.ui.selectedImportedKey = data.imported.blocks[0].key;
        }

        saveData();
        refreshImportedUI();
        refreshDebug();
      };

      var btnConvert = $('#sbx-btn-convert-basic');
      if (btnConvert) btnConvert.onclick = function () {
        if (!confirm("This will import rules from Basic panels (Scoring, Random, Ambient, Voices, etc.) into the Editor. \n\nExisting lists/blocks will be preserved, but duplicates might be created. Proceed?")) return;

        var imported = importRulesFromBasic(studioState, data);

        if (imported.lists) {
          for (var i = 0; i < imported.lists.length; i++) data.appState.lists.push(imported.lists[i]);
        }
        if (imported.blocks) {
          for (var j = 0; j < imported.blocks.length; j++) data.appState.blocks.push(imported.blocks[j]);
        }

        switchTab('editor');
        saveData();
        refreshAll();
        alert("Import complete! Added " + (imported.blocks ? imported.blocks.length : 0) + " new blocks.");
      };

      var btnGen = $('#sbx-btn-generate');
      if (btnGen) btnGen.onclick = function () {
        saveData();
        refreshGenerated();
        refreshDebug();
      };

      var btnCopy = $('#sbx-btn-copy');
      if (btnCopy) btnCopy.onclick = function () {
        var ta = $('#sbx-generated');
        if (!ta) return;
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } catch (_e) { }
      };

      var btnToggleDebug = $('#sbx-btn-toggle-debug');
      if (btnToggleDebug) btnToggleDebug.onclick = function () {
        data.ui.debugOpen = !data.ui.debugOpen;
        saveData();
        applyCollapsed();
      };

      var btnToggleImported = $('#sbx-btn-toggle-imported');
      if (btnToggleImported) btnToggleImported.onclick = function () {
        data.ui.importedOpen = !data.ui.importedOpen;
        saveData();
        applyCollapsed();
      };

      function applyCollapsed() {
        var importedBody = $('#sbx-imported-body');
        var dbgSec = $('#sbx-sec-debug');
        if (importedBody) importedBody.style.display = data.ui.importedOpen ? '' : 'none';
        if (btnToggleImported) btnToggleImported.innerHTML = data.ui.importedOpen ? 'Collapse' : 'Expand';
        if (dbgSec) dbgSec.style.display = data.ui.debugOpen ? '' : 'none';
      }

      var selLists = $('#sbx-existing-lists');
      var btnNewList = $('#sbx-btn-new-list');
      var btnSaveList = $('#sbx-btn-save-list');

      if (btnNewList) btnNewList.onclick = function () {
        clearListEditor();
        if (selLists) selLists.value = '';
      };

      function clearListEditor() {
        var name = $('#sbx-list-name');
        var desc = $('#sbx-list-desc');
        var items = $('#sbx-list-items');
        if (name) name.value = '';
        if (desc) desc.value = '';
        if (items) items.value = '';
      }

      function loadListIntoEditor(listId) {
        var name = $('#sbx-list-name');
        var desc = $('#sbx-list-desc');
        var items = $('#sbx-list-items');
        var l = getListById(data.appState, listId);
        if (!l) return;

        if (name) name.value = String(l.id || '');
        if (desc) desc.value = String(l.description || '');
        if (items) items.value = (isArr(l.items) ? l.items.join('\n') : '');
      }

      if (selLists) selLists.onchange = function () {
        var v = String(selLists.value || '');
        if (!v) { clearListEditor(); return; }
        loadListIntoEditor(v);
      };

      if (btnSaveList) btnSaveList.onclick = function () {
        var name = $('#sbx-list-name');
        var desc = $('#sbx-list-desc');
        var items = $('#sbx-list-items');

        var id = name ? String(name.value || '').replace(/\s+/g, '') : '';
        if (!id) return;

        var list = getListById(data.appState, id);
        if (!list) {
          list = { id: id, label: '', description: '', items: [] };
          data.appState.lists.push(list);
        }

        list.id = id;
        list.description = desc ? String(desc.value || '') : '';
        list.items = items ? splitLines(items.value) : [];

        saveData();
        refreshListsSelect();
        if (selLists) selLists.value = id;
        refreshListsPreview();
        refreshDerivedUI();
        refreshBlocksUI();
        refreshGenerated();
        refreshDebug();
      };

      var btnAddDerived = $('#sbx-btn-add-derived');
      if (btnAddDerived) btnAddDerived.onclick = function () {
        data.appState.derived.push({ key: uid('derived'), description: '', listId: '', windowSize: 10 });
        saveData();
        refreshDerivedUI();
        refreshDebug();
        refreshGenerated();
      };

      var btnIf = $('#sbx-btn-add-if');
      var btnElseIf = $('#sbx-btn-add-elseif');
      var btnElse = $('#sbx-btn-add-else');

      function addBlock(type) {
        data.appState.blocks.push(makeDefaultBlock(type));
        saveData();
        refreshBlocksUI();
        refreshDebug();
        refreshGenerated();
      }

      if (btnIf) btnIf.onclick = function () { addBlock('if'); };
      if (btnElseIf) btnElseIf.onclick = function () { addBlock('elseif'); };
      if (btnElse) btnElse.onclick = function () { addBlock('else'); };

      // ---------------------------
      // Tabs
      // ---------------------------
      var tabEd = $('#sbx-tab-editor');
      var tabTest = $('#sbx-tab-test');
      var viewEd = $('#sbx-view-editor');
      var viewTest = $('#sbx-view-test');
      var edToolbar = $('#sbx-editor-toolbar');

      function switchTab(mode) {
        data.ui.viewMode = mode;
        saveData();

        if (tabEd) tabEd.className = (mode !== 'test' ? 'btn btn-primary' : 'btn btn-ghost');
        if (tabTest) tabTest.className = (mode === 'test' ? 'btn btn-primary' : 'btn btn-ghost');
        if (viewEd) viewEd.style.display = (mode !== 'test' ? 'grid' : 'none');
        if (viewTest) viewTest.style.display = (mode === 'test' ? 'grid' : 'none');
        if (edToolbar) edToolbar.style.display = (mode !== 'test' ? 'flex' : 'none');
      }
      if (tabEd) tabEd.onclick = function () { switchTab('editor'); };
      if (tabTest) tabTest.onclick = function () { switchTab('test'); };

      // ---------------------------
      // Test Harness Wiring
      // ---------------------------
      function thRenderMessages() {
        var wrap = $('#sbx-th-messages');
        if (!wrap) return;
        wrap.innerHTML = "";

        if (!thState.messages.length) {
          wrap.innerHTML = '<div class="sbx-muted">(no test messages yet)</div>';
          return;
        }

        for (var i = 0; i < thState.messages.length; i++) {
          (function (idx) {
            var row = document.createElement("div");
            row.className = "sbx-rowcard sbx-rowcard-tight";

            var hdr = document.createElement("div");
            hdr.className = "sbx-row sbx-row-tight";
            hdr.innerHTML = '<span class="sbx-chip">Message ' + (idx + 1) + '</span>';

            var btnRm = document.createElement("button");
            btnRm.className = "btn btn-ghost sbx-cond-del";
            btnRm.textContent = "Remove";
            btnRm.onclick = function () {
              thState.messages.splice(idx, 1);
              thRenderMessages();
            };
            hdr.appendChild(btnRm);
            row.appendChild(hdr);

            var ta = document.createElement("textarea");
            ta.className = "inp sbx-ta";
            ta.style.marginBottom = "5px";
            ta.value = String(thState.messages[idx].text || "");
            ta.oninput = function () { thState.messages[idx].text = ta.value; };
            row.appendChild(ta);

            wrap.appendChild(row);
          })(i);
        }
      }

      var btnThAdd = $('#sbx-th-add-msg');
      if (btnThAdd) btnThAdd.onclick = function () {
        thState.messages.push({ text: "" });
        thRenderMessages();
      };

      var btnThResetStrict = $('#sbx-th-reset-all');
      if (btnThResetStrict) btnThResetStrict.onclick = function () {
        if (!confirm("Clear all test inputs?")) return;
        thState.messages = [];
        var p = $('#sbx-th-personality'); if (p) p.value = "";
        var s = $('#sbx-th-scenario'); if (s) s.value = "";
        var r = $('#sbx-th-results'); if (r) r.textContent = "";
        thRenderMessages();
      };

      var btnThRun = $('#sbx-th-run');
      if (btnThRun) btnThRun.onclick = function () {
        var ctx = { chat: {}, character: {} };
        var p = $('#sbx-th-personality');
        var s = $('#sbx-th-scenario');
        ctx.character.personality = p ? String(p.value || "") : "";
        ctx.character.scenario = s ? String(s.value || "") : "";
        ctx.character.memory = {};

        var last = [];
        for (var i = 0; i < thState.messages.length; i++) {
          last.push({ message: String(thState.messages[i].text || "") });
        }
        ctx.chat.last_messages = last;
        var rawLast = last.length ? String(last[last.length - 1].message || "") : "";

        var env = {
          appState: data.appState,
          context: ctx,
          messageCount: last.length,
          normLastUserMsg: thNormalize(rawLast),
          normHistory: [],
          derived: {}
        };
        for (var j = 0; j < last.length; j++) {
          env.normHistory.push(thNormalize(String(last[j].message || "")));
        }
        env.derived = thComputeDerived(data.appState, env);
        env._gateCounter = { n: 0 };

        var lines = [];
        lines.push("=== Derived Values ===");
        var anyD = false;
        for (var k in env.derived) {
          if (hasOwn(env.derived, k)) {
            anyD = true;
            lines.push(k + ": " + env.derived[k]);
          }
        }
        if (!anyD) lines.push("(none)");
        lines.push("");
        lines.push("=== Block Trace ===");

        var blocks = data.appState.blocks || [];
        var hasIf = false, hasElse = false, chainTaken = false;
        var anyExec = false, anyOut = false;

        for (var b = 0; b < blocks.length; b++) {
          var block = blocks[b];
          var explain = (block.type === "else") ? { ok: true, lines: [] } : thExplainBlockConditions(block, env);
          var cond = (block.type === "else") ? true : !!explain.ok;
          var eligible = true, executed = false;

          if (block.type === "if") {
            hasIf = true; hasElse = false; chainTaken = false;
            eligible = true;
            executed = !!cond;
            if (executed) chainTaken = true;
          } else if (block.type === "elseif") {
            if (hasIf && !hasElse) {
              eligible = !chainTaken;
              executed = eligible && !!cond;
              if (executed) chainTaken = true;
            } else {
              hasIf = true; hasElse = false; chainTaken = false;
              eligible = true;
              executed = !!cond;
              if (executed) chainTaken = true;
            }
          } else if (block.type === "else") {
            cond = true;
            if (hasIf && !hasElse) {
              eligible = !chainTaken;
              executed = eligible;
              hasElse = true;
              if (executed) chainTaken = true;
            } else {
              hasIf = true; hasElse = false; chainTaken = true;
              eligible = true;
              executed = true;
            }
          }

          if (executed) anyExec = true;

          var ran = [];
          if (executed && block.actions && block.actions.length) {
            for (var a = 0; a < block.actions.length; a++) thApplyAction(block.actions[a], ctx, ran, data.appState);
          }
          if (ran.length) anyOut = true;

          var label = block.label ? (" [" + block.label + "]") : "";
          lines.push((b + 1) + ". " + String(block.type || "").toUpperCase() + label +
            " | cond=" + (block.type === "else" ? "n/a" : cond) +
            " | exec=" + (executed ? "YES" : "no"));

          if (block.type !== "else" && explain.lines) {
            for (var gl = 0; gl < explain.lines.length; gl++) lines.push("   " + explain.lines[gl]);
          }
          if (ran.length) lines.push("   ACT: " + ran.join("; "));
        }

        if (!anyExec) lines.push("\nOutput -> No Output Condition Reached.");
        else if (!anyOut) lines.push("\nOutput -> Condition(s) executed, but no actions produced.");
        else lines.push("\nOutput -> Actions produced (see above).");

        lines.push("\n=== Final Personality ===\n" + String(ctx.character.personality || ""));
        lines.push("\n=== Final Scenario ===\n" + String(ctx.character.scenario || ""));
        lines.push("\n=== Final Memory ===\n" + JSON.stringify(ctx.character.memory || {}, null, 2));

        var outDiv = $('#sbx-th-results');
        if (outDiv) outDiv.textContent = lines.join("\n");
      };

      thRenderMessages();
      applyCollapsed();
      refreshAll();
    }
  });

  // ---------------------------
  // Scoped CSS (no bleed)
  // ---------------------------
  function injectCssOnce() {
    if (document.getElementById(CSS_ID)) return;

    var css =
      '.sbx-panel{display:block}' +
      '.sbx-panel .sbx-head{margin-bottom:12px}' +
      '.sbx-panel .sbx-title{font-weight:900;font-size:16px}' +
      '.sbx-panel .sbx-sub{color:var(--muted);font-weight:800;font-size:12px;margin-top:4px;line-height:1.35}' +
      '.sbx-panel .sbx-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px}' +
      '.sbx-panel .sbx-row-top{margin-top:10px}' +
      '.sbx-panel .sbx-row-l{display:flex;gap:8px;flex:1;align-items:center}' +
      '.sbx-panel .sbx-row-r{display:flex;gap:8px;justify-content:flex-end;align-items:center}' +
      '.sbx-panel .sbx-row-stack{flex-direction:column;align-items:stretch}' +
      '.sbx-panel .sbx-row-tight{margin-top:6px}' +
      '.sbx-panel .sbx-pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:12px;white-space:pre-wrap;line-height:1.4;color:var(--text-normal)}' +

      '.sbx-panel .sbx-layout{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
      '.sbx-panel .sbx-col{min-width:0}' +

      '.sbx-panel .sbx-section{background:rgba(0,0,0,.06);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:12px}' +
      '.sbx-panel .sbx-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}' +
      '.sbx-panel .sbx-h2{font-weight:900;letter-spacing:.2px}' +
      '.sbx-panel .sbx-h3{font-weight:900;color:var(--muted);margin:10px 0 6px;text-transform:uppercase;font-size:12px;letter-spacing:.8px}' +
      '.sbx-panel .sbx-small{color:var(--muted);font-weight:800;font-size:12px;line-height:1.35}' +
      '.sbx-panel .sbx-muted{color:var(--muted);font-weight:800;font-size:12px;line-height:1.35}' +

      '.sbx-panel .sbx-lab{color:var(--muted);font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.8px;display:block;width:100%}' +
      '.sbx-panel .sbx-sel{margin-left:8px}' +

      '.sbx-panel .sbx-ta{width:100%;resize:vertical;min-height:70px}' +
      '.sbx-panel .sbx-ta-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:12px}' +

      '.sbx-panel .sbx-card{border:1px solid var(--border);border-radius:12px;padding:10px;background:rgba(0,0,0,.04)}' +
      '.sbx-panel .sbx-listcard{border:1px solid var(--border);border-radius:12px;padding:10px;background:rgba(43,33,27,.22);margin-bottom:8px}' +
      '.sbx-panel .sbx-listcard-h{font-weight:900}' +

      '.sbx-panel .sbx-chip{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:rgba(0,0,0,.04);font-weight:900;font-size:12px;margin-right:8px}' +
      '.sbx-panel .sbx-chip-strong{background:rgba(201,164,106,.10);border-color:rgba(201,164,106,.35)}' +
      '.sbx-panel .sbx-meta{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}' +
      '.sbx-panel .sbx-tag{opacity:.75;margin-left:6px}' +

      '.sbx-panel .sbx-import-grid{display:grid;grid-template-columns:320px 1fr;gap:10px;margin-top:10px}' +
      '.sbx-panel .sbx-import-list{display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto}' +
      '.sbx-panel .sbx-item{border:1px solid var(--border);border-radius:12px;padding:10px;background:rgba(43,33,27,.22);text-align:left;cursor:pointer}' +
      '.sbx-panel .sbx-item.is-active{outline:2px solid rgba(201,164,106,.45)}' +
      '.sbx-panel .sbx-item-top{font-weight:900}' +
      '.sbx-panel .sbx-item-sub{color:var(--muted);font-weight:900;font-size:12px;margin-top:2px}' +

      '.sbx-panel .sbx-block{border:1px solid var(--border);border-radius:12px;padding:10px;background:rgba(43,33,27,.22);margin-top:10px}' +
      '.sbx-panel .sbx-block-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}' +

      '.sbx-panel .sbx-rowcard{border:1px dashed rgba(255,255,255,.16);background:rgba(255,255,255,.02);border-radius:12px;padding:10px;margin-top:8px}' +
      '.sbx-panel .sbx-rowcard-tight{padding:8px}' +

      '@media (max-width: 980px){.sbx-panel .sbx-layout{grid-template-columns:1fr}.sbx-panel .sbx-import-grid{grid-template-columns:1fr}}';

    var style = document.createElement('style');
    style.id = CSS_ID;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

})(window);

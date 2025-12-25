(function (root) {
  'use strict';

  var SBX = root.SBX = root.SBX || {};
  SBX.Import = SBX.Import || {};

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  function toInt(v, d) {
    v = parseInt(v, 10);
    return isNaN(v) ? d : v;
  }

  function clampInt(n, lo, hi) {
    n = toInt(n, lo);
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  function getBasicPanelState(studioState, panelId) {
    // Check StudioState first (hydrated in memory)
    if (studioState && studioState.data && studioState.data[panelId]) {
      return studioState.data[panelId];
    }
    // Fallback to localStorage persistence
    try {
      var raw = root.localStorage ? root.localStorage.getItem('studio.data.' + panelId) : '';
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_e) { }
    return null;
  }


  function splitKeywordsRaw(raw) {
    raw = String(raw == null ? '' : raw);
    if (!raw) return [];

    var lines = raw.split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = trim(lines[i]);
      if (!line) continue;

      // support both comma-separated and one-per-line
      var parts = line.split(',');
      for (var j = 0; j < parts.length; j++) {
        var t = trim(parts[j]);
        if (!t) continue;
        out.push(t);
      }
    }
    return out;
  }

  function listSignature(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) out.push(String(items[i]));
    return out.join('|');
  }

  function ensureContainers(sbxData) {
    sbxData = sbxData || {};
    sbxData.modules = sbxData.modules || {};
    sbxData.moduleOrder = sbxData.moduleOrder || [];

    // Global lists shared across modules
    sbxData.lists = isArr(sbxData.lists) ? sbxData.lists : [];

    return sbxData;
  }

  function ensureModuleAppState(sbxData, moduleId, metaLabel) {
    sbxData = ensureContainers(sbxData);

    if (!sbxData.modules[moduleId]) {
      sbxData.modules[moduleId] = {
        id: moduleId,
        label: metaLabel || moduleId,
        description: '',
        ui: {},
        appState: { lists: [], derived: [], blocks: [] }
      };
      sbxData.moduleOrder.push(moduleId);
    } else {
      sbxData.modules[moduleId].appState = sbxData.modules[moduleId].appState || { lists: [], derived: [], blocks: [] };
      sbxData.modules[moduleId].appState.lists = isArr(sbxData.modules[moduleId].appState.lists) ? sbxData.modules[moduleId].appState.lists : [];
      sbxData.modules[moduleId].appState.derived = isArr(sbxData.modules[moduleId].appState.derived) ? sbxData.modules[moduleId].appState.derived : [];
      sbxData.modules[moduleId].appState.blocks = isArr(sbxData.modules[moduleId].appState.blocks) ? sbxData.modules[moduleId].appState.blocks : [];
      // ensure order contains it
      var found = false;
      for (var i = 0; i < sbxData.moduleOrder.length; i++) if (sbxData.moduleOrder[i] === moduleId) found = true;
      if (!found) sbxData.moduleOrder.push(moduleId);
    }

    return sbxData.modules[moduleId].appState;
  }

  // Create/find a list in GLOBAL pool (sbxData.lists), return listId.
  function mkGlobalList(sbxData, items, label) {
    sbxData = ensureContainers(sbxData);
    if (!items || !items.length) return '';

    var clean = [];
    var seen = {};
    var i;
    for (i = 0; i < items.length; i++) {
      var t = trim(items[i]);
      if (!t) continue;
      if (seen[t]) continue;
      seen[t] = true;
      clean.push(t);
    }
    if (!clean.length) return '';

    var sig = listSignature(clean);
    var lists = sbxData.lists;

    // Deduplicate by signature
    for (i = 0; i < lists.length; i++) {
      var ex = lists[i];
      if (ex && isArr(ex.items) && listSignature(ex.items) === sig) return ex.id;
    }

    var id = 'lst_' + Math.random().toString(36).slice(2, 8);
    sbxData.lists.push({
      id: id,
      label: label || id,
      description: '',
      items: clean
    });
    return id;
  }

  function makeDefaultBlock(type) {
    return {
      id: 'blk_' + Math.random().toString(36).slice(2, 10),
      type: type || 'if',
      label: '',
      description: '',
      join: 'AND',
      conditions: (type === 'else') ? [] : [],
      actions: []
    };
  }

  // =========================
  // Lorebook (Basic) helpers
  // =========================

  // lorebook.panel.js uses ls key 'studio.data.lorebook'
  function getBasicLorebookState(studioState) {
    // preferred: hydrated in StudioState
    if (studioState && studioState.data && studioState.data.lorebook && isArr(studioState.data.lorebook.entries)) {
      return studioState.data.lorebook;
    }
    // fallback: localStorage persistence
    try {
      var raw = root.localStorage ? root.localStorage.getItem('studio.data.lorebook') : '';
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && isArr(parsed.entries)) return parsed;
    } catch (_e) { }
    return null;
  }

  function importLorebook(studioState, sbxData) {
    sbxData = ensureContainers(sbxData);

    var app = ensureModuleAppState(sbxData, 'lorebook', 'Lorebook');

    // overwrite module’s blocks only (module-scoped safety)
    app.blocks = [];

    var lb = getBasicLorebookState(studioState);
    if (!lb || lb.enabled === false || !isArr(lb.entries)) return;

    // import entries -> GLOBAL lists + module blocks
    for (var i = 0; i < lb.entries.length; i++) {
      var e = lb.entries[i];
      if (!e || e.enabled === false) continue;

      var items = splitKeywordsRaw(e.keywords || '');
      var listId = mkGlobalList(sbxData, items, 'Lorebook Keywords: ' + (e.title || ('Entry ' + (i + 1))));
      if (!listId) continue;

      var text = String(e.text || '');
      if (!text) continue;

      var tgt = (String(e.target || '') === 'personality') ? 'appendPersonality' : 'appendScenario';

      var b = makeDefaultBlock('if');
      b.label = e.title ? ('Lorebook: ' + String(e.title)) : ('Lorebook Entry ' + (i + 1));
      b.join = 'AND';

      b.conditions = [{
        nodeType: 'cond',
        not: false,
        type: 'anyInList',
        listId: listId,
        source: 'lastUserMsg',
        negationGuard: false,
        op: '>=',
        threshold: 1,
        windowSize: 8
      }];

      b.actions = [{ type: tgt, text: text }];

      app.blocks.push(b);
    }
  }

  // =========================
  // Memory (Basic) -> Advanced
  // =========================

  function getBasicMemoryState(studioState) {
    if (studioState && studioState.data && studioState.data.memory && isArr(studioState.data.memory.entries)) {
      return studioState.data.memory;
    }
    try {
      var raw = root.localStorage ? root.localStorage.getItem('studio.data.memory') : '';
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && isArr(parsed.entries)) return parsed;
    } catch (_e) { }
    return null;
  }

  function importMemory(studioState, sbxData) {
    sbxData = ensureContainers(sbxData);

    var app = ensureModuleAppState(sbxData, 'memory', 'Memory');

    // overwrite module’s blocks only (module-scoped safety)
    app.blocks = [];

    var mem = getBasicMemoryState(studioState);
    if (!mem || mem.enabled === false || !isArr(mem.entries)) return;

    for (var i = 0; i < mem.entries.length; i++) {
      var e = mem.entries[i];
      if (!e || e.enabled === false) continue;

      var items = splitKeywordsRaw(e.keywords || '');
      var listId = mkGlobalList(sbxData, items, 'Memory Keywords: ' + (e.title || ('Entry ' + (i + 1))));
      if (!listId) continue;

      var text = String(e.memoryText || e.text || '');
      if (!text) continue;

      var tgt = (String(e.target || '') === 'scenario') ? 'appendScenario' : 'appendPersonality';

      var b = makeDefaultBlock('if');
      b.label = e.title ? ('Memory: ' + String(e.title)) : ('Memory Entry ' + (i + 1));
      b.join = 'AND';

      b.conditions = [{
        nodeType: 'cond',
        not: false,
        type: 'anyInList',
        listId: listId,
        source: 'lastUserMsg',
        negationGuard: false,
        op: '>=',
        threshold: 1,
        windowSize: 8
      }];

      b.actions = [{ type: tgt, text: text }];

      app.blocks.push(b);
    }
  }

  // =========================
  // Tone (Basic) -> Advanced
  // =========================

  function getBasicToneState(studioState) {
    // prefer hydrated StudioState
    if (studioState && studioState.data && studioState.data.tone && isArr(studioState.data.tone.entries)) {
      return studioState.data.tone;
    }
    // fallback: localStorage
    try {
      var raw = root.localStorage ? root.localStorage.getItem('studio.data.tone') : '';
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && isArr(parsed.entries)) return parsed;
    } catch (_e2) { }
    return null;
  }

  function importTone(studioState, sbxData) {
    sbxData = ensureContainers(sbxData);

    var app = ensureModuleAppState(sbxData, 'tone', 'Tone');

    // overwrite module’s blocks only (module-scoped safety)
    app.blocks = [];

    var tone = getBasicToneState(studioState);
    if (!tone || !isArr(tone.entries)) return;

    for (var i = 0; i < tone.entries.length; i++) {
      var e = tone.entries[i];
      if (!e || e.enabled === false) continue;

      var items = splitKeywordsRaw(e.keywordsRaw || e.keywords || '');
      if (!items.length) continue;

      var listId = mkGlobalList(sbxData, items, 'Tone Keywords: ' + (items[0] || ('Entry ' + (i + 1))));
      if (!listId) continue;

      var text = String(e.text || '');
      if (!text) continue;

      var tgt = (String(e.targetId || '') === 'character.scenario') ? 'appendScenario' : 'appendPersonality';

      var b = makeDefaultBlock('if');
      b.label = 'Tone: ' + (items[0] || ('Entry ' + (i + 1)));
      b.join = 'AND';

      b.conditions = [{
        nodeType: 'cond',
        not: false,
        type: 'anyInList',
        listId: listId,
        source: 'lastUserMsg',
        negationGuard: false,
        op: '>=',
        threshold: 1,
        windowSize: 8
      }];

      b.actions = [{ type: tgt, text: text }];

      app.blocks.push(b);
    }
  }

  // =========================
  // Ambient (Basic) -> Advanced
  // =========================

  function importAmbient(studioState, sbxData) {
    sbxData = ensureContainers(sbxData);
    var app = ensureModuleAppState(sbxData, 'ambient', 'Ambient');
    app.blocks = [];

    var ambient = getBasicPanelState(studioState, 'ambient');
    if (!ambient || ambient.enabled === false || !isArr(ambient.groups)) return;

    for (var i = 0; i < ambient.groups.length; i++) {
      var g = ambient.groups[i];
      if (!g || g.enabled === false) continue;

      var pct = clampInt(g.triggerChancePct, 0, 100);
      if (pct <= 0) continue;

      // Build weighted list from items
      var weightedItems = [];
      var enabledItems = [];
      for (var j = 0; j < (g.items || []).length; j++) {
        var it = g.items[j];
        if (it && it.enabled !== false && trim(it.text)) {
          enabledItems.push(it);
        }
      }

      if (!enabledItems.length) continue;

      // Approximate weights by duplicating items (scale to ~10 per item)
      for (var k = 0; k < enabledItems.length; k++) {
        var item = enabledItems[k];
        var weight = clampInt(item.weightPct, 0, 100);
        var copies = Math.max(1, Math.round(weight / 10));
        for (var c = 0; c < copies; c++) {
          weightedItems.push(String(item.text));
        }
      }

      if (!weightedItems.length) continue;

      var listId = mkGlobalList(sbxData, weightedItems, 'Ambient: ' + (g.name || ('Group ' + (i + 1))));

      var b = makeDefaultBlock('if');
      b.label = 'Ambient: ' + (g.name || ('Group ' + (i + 1)));
      b.join = 'AND';
      b.conditions = [{
        nodeType: 'cond',
        not: false,
        type: 'randomChance',
        threshold: pct
      }];
      b.actions = [{
        type: 'appendRandomFromList',
        target: 'appendScenario',
        listId: listId
      }];

      app.blocks.push(b);
    }
  }

  // =========================
  // Random (Basic) -> Advanced
  // =========================

  function importRandom(studioState, sbxData) {
    sbxData = ensureContainers(sbxData);
    var app = ensureModuleAppState(sbxData, 'random', 'Random');
    app.blocks = [];

    var random = getBasicPanelState(studioState, 'random');
    if (!random || random.enabled === false || !isArr(random.groups)) return;

    for (var i = 0; i < random.groups.length; i++) {
      var g = random.groups[i];
      if (!g || g.enabled === false) continue;

      var pct = clampInt(g.triggerChancePct, 0, 100);
      if (pct <= 0) continue;

      // Build weighted list from items
      var weightedItems = [];
      var enabledItems = [];
      for (var j = 0; j < (g.items || []).length; j++) {
        var it = g.items[j];
        if (it && it.enabled !== false && trim(it.text)) {
          enabledItems.push(it);
        }
      }

      if (!enabledItems.length) continue;

      // Approximate weights by duplicating items
      for (var k = 0; k < enabledItems.length; k++) {
        var item = enabledItems[k];
        var weight = clampInt(item.weightPct, 0, 100);
        var copies = Math.max(1, Math.round(weight / 10));
        for (var c = 0; c < copies; c++) {
          weightedItems.push(String(item.text));
        }
      }

      if (!weightedItems.length) continue;

      var listId = mkGlobalList(sbxData, weightedItems, 'Random: ' + (g.name || ('Group ' + (i + 1))));

      // Determine target based on writeTargetId
      var targetAction = (g.writeTargetId === 'character.scenario') ? 'appendScenario' : 'appendPersonality';

      var b = makeDefaultBlock('if');
      b.label = 'Random: ' + (g.name || ('Group ' + (i + 1)));
      b.join = 'AND';
      b.conditions = [{
        nodeType: 'cond',
        not: false,
        type: 'randomChance',
        threshold: pct
      }];
      b.actions = [{
        type: 'appendRandomFromList',
        target: targetAction,
        listId: listId
      }];

      app.blocks.push(b);
    }
  }

  // =========================
  // Events (Basic) -> Advanced
  // =========================

  function importEvents(studioState, sbxData) {
    sbxData = ensureContainers(sbxData);
    var app = ensureModuleAppState(sbxData, 'events', 'Events');
    app.blocks = [];

    var events = getBasicPanelState(studioState, 'events');
    if (!events || !isArr(events.entries)) return;

    for (var i = 0; i < events.entries.length; i++) {
      var e = events.entries[i];
      if (!e || e.enabled === false) continue;

      var minC = toInt(e.minCount, 0);
      var maxC = toInt(e.maxCount, minC);
      if (maxC < minC) maxC = minC;

      var marker = e.once ? ('\n[Event: ' + (e.id || ('evt_' + i)) + ']') : '';
      var baseName = e.name || ('Messages ' + minC + '-' + maxC);

      // Personality block if textPersonality exists
      if (trim(e.textPersonality)) {
        var b1 = makeDefaultBlock('if');
        b1.label = 'Event: ' + baseName + ' (Personality)';
        b1.join = 'AND';
        b1.conditions = [
          {
            nodeType: 'cond',
            not: false,
            type: 'messageCountComparison',
            op: '>=',
            threshold: minC
          },
          {
            nodeType: 'cond',
            not: false,
            type: 'messageCountComparison',
            op: '<=',
            threshold: maxC
          }
        ];
        b1.actions = [{
          type: 'appendPersonality',
          text: String(e.textPersonality) + marker
        }];
        app.blocks.push(b1);
      }

      // Scenario block if textScenario exists
      if (trim(e.textScenario)) {
        var b2 = makeDefaultBlock('if');
        b2.label = 'Event: ' + baseName + ' (Scenario)';
        b2.join = 'AND';
        b2.conditions = [
          {
            nodeType: 'cond',
            not: false,
            type: 'messageCountComparison',
            op: '>=',
            threshold: minC
          },
          {
            nodeType: 'cond',
            not: false,
            type: 'messageCountComparison',
            op: '<=',
            threshold: maxC
          }
        ];
        b2.actions = [{
          type: 'appendScenario',
          text: String(e.textScenario) + marker
        }];
        app.blocks.push(b2);
      }
    }
  }

  // =========================
  // Scoring (Basic) -> Advanced
  // =========================

  function importScoring(studioState, sbxData) {
    sbxData = ensureContainers(sbxData);
    var app = ensureModuleAppState(sbxData, 'scoring', 'Scoring');
    app.blocks = [];

    var scoring = getBasicPanelState(studioState, 'scoring');
    if (!scoring || scoring.enabled === false || !isArr(scoring.topics)) return;

    for (var i = 0; i < scoring.topics.length; i++) {
      var t = scoring.topics[i];
      if (!t || t.enabled === false) continue;

      var keywords = splitKeywordsRaw(t.keywordsText || '');
      if (!keywords.length) continue;

      var contextText = String(t.contextFieldText || '');
      if (!trim(contextText)) continue;

      var listId = mkGlobalList(sbxData, keywords, 'Scoring: ' + (t.name || ('Topic ' + (i + 1))));

      var depth = clampInt(t.messageDepth, 1, 200);
      var minV = clampInt(t.thresholdMin, 0, 999);

      var b = makeDefaultBlock('if');
      b.label = 'Scoring: ' + (t.name || ('Topic ' + (i + 1)));
      b.join = 'AND';

      // Min threshold condition
      b.conditions = [{
        nodeType: 'cond',
        not: false,
        type: 'countInHistory',
        listId: listId,
        windowSize: depth,
        op: '>=',
        threshold: minV
      }];

      // Max threshold if enabled
      if (t.useMax) {
        var maxV = clampInt(t.thresholdMax, 0, 999);
        if (maxV < minV) maxV = minV;
        b.conditions.push({
          nodeType: 'cond',
          not: false,
          type: 'countInHistory',
          listId: listId,
          windowSize: depth,
          op: '<=',
          threshold: maxV
        });
      }

      var targetAction = (t.writeTargetId === 'character.scenario') ? 'appendScenario' : 'appendPersonality';
      b.actions = [{
        type: targetAction,
        text: contextText
      }];

      app.blocks.push(b);
    }
  }

  // =========================
  // Voices (Basic) -> Advanced
  // =========================

  function importVoices(studioState, sbxData) {
    sbxData = ensureContainers(sbxData);
    var app = ensureModuleAppState(sbxData, 'voices', 'Voices');
    app.blocks = [];

    var voices = getBasicPanelState(studioState, 'voices');
    if (!voices || !isArr(voices.voices)) return;

    for (var i = 0; i < voices.voices.length; i++) {
      var v = voices.voices[i];
      if (!v || v.enabled === false) continue;

      var voiceName = v.name || ('Voice ' + (i + 1));

      // Context (always append - no condition)
      if (trim(v.context)) {
        var bc = makeDefaultBlock('if');
        bc.label = 'Voice: ' + voiceName + ' (Context)';
        bc.conditions = []; // Always true (empty conditions = always execute)
        bc.actions = [{
          type: 'appendPersonality',
          text: String(v.context)
        }];
        app.blocks.push(bc);
      }

      // Personality rails (random chance)
      if (isArr(v.personalityRails)) {
        var railTexts = [];
        for (var j = 0; j < v.personalityRails.length; j++) {
          var rail = v.personalityRails[j];
          if (rail && rail.enabled !== false && trim(rail.text)) {
            railTexts.push(String(rail.text));
          }
        }
        if (railTexts.length) {
          var railListId = mkGlobalList(sbxData, railTexts, 'Voice Rails: ' + voiceName);
          var railChance = clampInt(v.railFrequency || 15, 0, 100);

          var br = makeDefaultBlock('if');
          br.label = 'Voice: ' + voiceName + ' (Rails)';
          br.join = 'AND';
          br.conditions = [{
            nodeType: 'cond',
            not: false,
            type: 'randomChance',
            threshold: railChance
          }];
          br.actions = [{
            type: 'appendRandomFromList',
            target: 'appendPersonality',
            listId: railListId
          }];
          app.blocks.push(br);
        }
      }

      // Attempt rails (random chance)
      if (isArr(v.attemptRails)) {
        var attemptTexts = [];
        for (var k = 0; k < v.attemptRails.length; k++) {
          var attempt = v.attemptRails[k];
          if (attempt && attempt.enabled !== false && trim(attempt.text)) {
            attemptTexts.push(String(attempt.text));
          }
        }
        if (attemptTexts.length) {
          var attemptListId = mkGlobalList(sbxData, attemptTexts, 'Voice Attempts: ' + voiceName);
          var attemptChance = clampInt(v.attemptFrequency || 15, 0, 100);

          var ba = makeDefaultBlock('if');
          ba.label = 'Voice: ' + voiceName + ' (Attempts)';
          ba.join = 'AND';
          ba.conditions = [{
            nodeType: 'cond',
            not: false,
            type: 'randomChance',
            threshold: attemptChance
          }];
          ba.actions = [{
            type: 'appendRandomFromList',
            target: 'appendPersonality',
            listId: attemptListId
          }];
          app.blocks.push(ba);
        }
      }

      // Subtones (individual random blocks for each)
      if (isArr(v.subtones)) {
        for (var m = 0; m < v.subtones.length; m++) {
          var subtone = v.subtones[m];
          if (!subtone || subtone.enabled === false) continue;

          var stRails = [];
          if (isArr(subtone.rails)) {
            for (var n = 0; n < subtone.rails.length; n++) {
              if (subtone.rails[n] && trim(subtone.rails[n])) {
                stRails.push(String(subtone.rails[n]));
              }
            }
          }

          if (!stRails.length) continue;

          var subtoneName = subtone.name || ('Subtone ' + (m + 1));
          var subtoneListId = mkGlobalList(sbxData, stRails, 'Voice Subtone: ' + voiceName + ' - ' + subtoneName);
          var subtoneChance = clampInt(subtone.frequency || 10, 0, 100);

          var bs = makeDefaultBlock('if');
          bs.label = 'Voice: ' + voiceName + ' (' + subtoneName + ')';
          bs.join = 'AND';
          bs.conditions = [{
            nodeType: 'cond',
            not: false,
            type: 'randomChance',
            threshold: subtoneChance
          }];
          bs.actions = [{
            type: 'appendRandomFromList',
            target: 'appendPersonality',
            listId: subtoneListId
          }];
          app.blocks.push(bs);
        }
      }
    }
  }

  // =========================
  // Public API
  // =========================

  function fromBasicModule(studioState, sbxData, moduleId) {
    moduleId = String(moduleId || '');
    sbxData = ensureContainers(sbxData);

    if (moduleId === 'lorebook') {
      importLorebook(studioState, sbxData);
    } else if (moduleId === 'memory') {
      importMemory(studioState, sbxData);
    } else if (moduleId === 'tone') {
      importTone(studioState, sbxData);
    } else if (moduleId === 'ambient') {
      importAmbient(studioState, sbxData);
    } else if (moduleId === 'random') {
      importRandom(studioState, sbxData);
    } else if (moduleId === 'events') {
      importEvents(studioState, sbxData);
    } else if (moduleId === 'scoring') {
      importScoring(studioState, sbxData);
    } else if (moduleId === 'voices') {
      importVoices(studioState, sbxData);
    }

    return sbxData;
  }

  SBX.Import.fromBasicModule = fromBasicModule;

})(window);

(function (root) {
  'use strict';

  // Advanced Test Harness:
  // - Uses Advanced (SBX) config: global lists + per-module derived/blocks.
  // - Simulates a JanitorAI-like context with personality / scenario / message history.
  // - Can run a single module or all modules in Engine build order.
  // - Right side shows derived values, block trace, and final state.

  if (!root || !root.SBX) { return; }

  var SBX = root.SBX;
  SBX.pages = SBX.pages || {};
  SBX.pages.test = SBX.pages.test || {};

  var dom = SBX.dom;
  var store = SBX.store;

  function isArr(x) {
    return Object.prototype.toString.call(x) === '[object Array]';
  }

  function normalize(str) {
    str = String(str == null ? '' : str).toLowerCase();
    str = str.replace(/[^a-z0-9_\s-]/g, ' ');
    str = str.replace(/[-_]+/g, ' ');
    str = str.replace(/\s+/g, ' ');
    return str.trim();
  }

  // ---------------------------
  // Module metadata + build order (mirror Engine page)
  // ---------------------------
  function getModulesList() {
    if (SBX.modules && typeof SBX.modules.list === 'function') {
      try {
        var lst = SBX.modules.list();
        return isArr(lst) ? lst : [];
      } catch (_e0) { }
    }
    if (SBX.moduleRegistry && isArr(SBX.moduleRegistry)) return SBX.moduleRegistry;
    return [];
  }

  var BUILD_ORDER_KEY = 'studio.buildOrder';

  function loadBuildOrder(allowedIds) {
    allowedIds = isArr(allowedIds) ? allowedIds : [];
    var allowed = {};
    var i;
    for (i = 0; i < allowedIds.length; i++) {
      allowed[String(allowedIds[i])] = true;
    }

    var raw;
    try {
      raw = root.localStorage.getItem(BUILD_ORDER_KEY);
    } catch (_e0) {
      raw = null;
    }
    var order = [];
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (isArr(parsed)) order = parsed;
      } catch (_e1) { }
    }

    var out = [];
    var seen = {};
    for (i = 0; i < order.length; i++) {
      var id = String(order[i]);
      if (!id || !allowed[id] || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    for (i = 0; i < allowedIds.length; i++) {
      var mid = String(allowedIds[i]);
      if (!seen[mid]) out.push(mid);
    }
    return out;
  }

  // ---------------------------
  // Minimal evaluator over Advanced-style appState
  // ---------------------------
  function evalRun(appState, env) {
    appState = appState || {};
    var blocks = isArr(appState.blocks) ? appState.blocks : [];
    var ctx = env.context;
    var trace = [];

    function getList(listId) {
      var lists = isArr(appState.lists) ? appState.lists : [];
      listId = String(listId || '');
      var i;
      for (i = 0; i < lists.length; i++) {
        var L = lists[i] || {};
        if (String(L.id || '') === listId) {
          return isArr(L.items) ? L.items : [];
        }
      }
      return [];
    }

    function anyInList(text, list) {
      text = normalize(text);
      var i;
      for (i = 0; i < list.length; i++) {
        var needle = normalize(list[i]);
        if (needle && text.indexOf(needle) !== -1) return true;
      }
      return false;
    }

    function countInHistory(normHistory, list, windowSize) {
      normHistory = isArr(normHistory) ? normHistory : [];
      windowSize = parseInt(windowSize, 10);
      if (isNaN(windowSize) || windowSize <= 0) windowSize = normHistory.length;
      var start = normHistory.length - windowSize;
      if (start < 0) start = 0;
      var count = 0;
      var i;
      for (i = start; i < normHistory.length; i++) {
        if (anyInList(normHistory[i], list)) count++;
      }
      return count;
    }

    function compare(op, a, b) {
      if (op === '>=') return a >= b;
      if (op === '>') return a > b;
      if (op === '==') return a == b;
      if (op === '!=') return a != b;
      if (op === '<=') return a <= b;
      if (op === '<') return a < b;
      return false;
    }

    // Find first matching item in list (for explanations)
    function findFirstMatch(text, list) {
      var haystack = normalize(text);
      for (var i = 0; i < list.length; i++) {
        var raw = String(list[i] || '');
        var needle = normalize(raw);
        if (needle && haystack.indexOf(needle) !== -1) return raw;
      }
      return '';
    }

    function checkCond(c, gateNum, explainMode) {
      if (!c) return { ok: true, explain: '' };

      // Groups
      if (c.nodeType === 'group') {
        var join = String(c.join || 'and').toLowerCase() === 'or' ? 'or' : 'and';
        var kids = isArr(c.children) ? c.children : [];
        var ok = (join === 'and') ? true : false;
        var explains = [];
        var i;
        if (kids.length) {
          if (join === 'and') {
            for (i = 0; i < kids.length; i++) {
              var r = checkCond(kids[i], gateNum + i, explainMode);
              if (explainMode && r.explain) explains.push(r.explain);
              if (!r.ok) { ok = false; break; }
            }
          } else {
            ok = false;
            for (i = 0; i < kids.length; i++) {
              var r2 = checkCond(kids[i], gateNum + i, explainMode);
              if (explainMode && r2.explain) explains.push(r2.explain);
              if (r2.ok) { ok = true; break; }
            }
          }
        } else {
          ok = true;
        }

        var groupExplain = '';
        if (explainMode && explains.length) {
          groupExplain = explains.join('\n');
        }

        if (c.not) ok = !ok;
        return { ok: ok, explain: groupExplain };
      }

      // Leaf
      var t = String(c.type || '');
      var op = String(c.op || '>=');
      var thr = parseFloat(c.threshold);
      if (isNaN(thr)) thr = 0;

      var ok2 = true;
      var explain = '';
      var list, ws, cnt, mc, v, dv;
      var gatePrefix = explainMode ? ('Gate ' + gateNum + ' → ') : '';

      if (t === 'anyInList' || t === 'noneInList') {
        list = getList(c.listId);
        var src = env.lastUserMsg || '';
        ok2 = anyInList(src, list);

        if (explainMode) {
          var match = findFirstMatch(src, list);
          if (t === 'anyInList') {
            if (ok2 && match) {
              explain = gatePrefix + 'Target text included "' + match + '".';
            } else {
              explain = gatePrefix + 'Target text did not include any target phrases.';
            }
          } else {
            // noneInList
            if (!ok2 && match) {
              explain = gatePrefix + 'Target text included "' + match + '" (but should NOT).';
            } else {
              explain = gatePrefix + 'Target text did not include any target phrases.';
            }
          }
        }

        if (t === 'noneInList') ok2 = !ok2;

      } else if (t === 'countInHistory') {
        list = getList(c.listId);
        ws = c.windowSize;
        cnt = countInHistory(env.normHistory, list, ws);
        ok2 = compare(op, cnt, thr);

        if (explainMode) {
          explain = gatePrefix + 'In the last ' + (ws || 10) + ' message(s), the count was ' + cnt + ' (needs ' + op + ' ' + thr + ').';
        }

      } else if (t === 'messageCountComparison') {
        mc = env.messageCount || 0;
        if (op === 'every') ok2 = (mc > 0 && (mc % thr === 0));
        else ok2 = compare(op, mc, thr);

        if (explainMode) {
          explain = gatePrefix + 'Message count was ' + mc + ' (needs ' + op + ' ' + thr + ').';
        }

      } else if (t === 'memoryNumberComparison') {
        v = parseFloat((ctx.character.memory || {})[c.memKey] || 0);
        if (isNaN(v)) v = 0;
        ok2 = compare(op, v, thr);

        if (explainMode) {
          explain = gatePrefix + 'Memory number "' + (c.memKey || '') + '" was ' + v + ' (needs ' + op + ' ' + thr + ').';
        }

      } else if (t === 'memoryStringContains') {
        var memStr = String((ctx.character.memory || {})[c.memKey] || '');
        var needleM = c.textContains || c.text || '';
        ok2 = normalize(memStr).indexOf(normalize(needleM)) !== -1;

        if (explainMode) {
          explain = gatePrefix + 'Memory text "' + (c.memKey || '') + '"' + (ok2 ? ' included' : ' did not include') + ' "' + needleM + '".';
        }

      } else if (t === 'personalityContains') {
        var needleP = c.text || '';
        ok2 = normalize(ctx.character.personality || '').indexOf(normalize(needleP)) !== -1;

        if (explainMode) {
          explain = gatePrefix + 'Personality' + (ok2 ? ' included' : ' did not include') + ' "' + needleP + '".';
        }

      } else if (t === 'scenarioContains') {
        var needleS = c.text || '';
        ok2 = normalize(ctx.character.scenario || '').indexOf(normalize(needleS)) !== -1;

        if (explainMode) {
          explain = gatePrefix + 'Scenario' + (ok2 ? ' included' : ' did not include') + ' "' + needleS + '".';
        }

      } else if (t === 'messageHistoryContains') {
        var needle = normalize(c.text || '');
        ws = parseInt(c.windowSize, 10);
        if (isNaN(ws) || ws <= 0) ws = 5;
        var start = Math.max(0, env.normHistory.length - ws);
        ok2 = false;
        var foundAt = -1;
        for (var i = start; i < env.normHistory.length; i++) {
          if (env.normHistory[i].indexOf(needle) !== -1) {
            ok2 = true;
            foundAt = i + 1; // 1-indexed for display
            break;
          }
        }

        if (explainMode) {
          if (ok2) {
            explain = gatePrefix + 'Last ' + ws + ' messages included "' + (c.text || '') + '" (found in Message ' + foundAt + ').';
          } else {
            explain = gatePrefix + 'Last ' + ws + ' messages did not include "' + (c.text || '') + '".';
          }
        }

      } else if (t === 'randomChance') {
        var pct = parseFloat(c.threshold);
        if (isNaN(pct)) pct = 0;
        ok2 = (Math.random() * 100 < pct);

        if (explainMode) {
          explain = gatePrefix + 'Random check (' + pct + '% chance): ' + (ok2 ? 'PASSED' : 'FAILED') + '.';
        }

      } else if (t === 'derivedNumberComparison') {
        dv = parseFloat((env.derived || {})[c.derivedKey] || 0);
        if (isNaN(dv)) dv = 0;
        ok2 = compare(op, dv, thr);

        if (explainMode) {
          explain = gatePrefix + 'Derived "' + (c.derivedKey || '') + '" was ' + dv + ' (needs ' + op + ' ' + thr + ').';
        }
      }

      // Apply NOT modifier
      if (c.not) {
        var beforeNot = ok2;
        ok2 = !ok2;
        if (explainMode && explain) {
          explain += '\n' + gatePrefix + 'NOT applied (' + (beforeNot ? 'pass' : 'fail') + ' becomes ' + (ok2 ? 'pass' : 'fail') + ').';
        }
      }

      return { ok: ok2, explain: explain };
    }

    function applyAction(a) {
      if (!a) return '';
      var t = String(a.target || a.type || '');
      var txt = String(a.text == null ? '' : a.text);
      ctx.character = ctx.character || {};
      ctx.character.memory = ctx.character.memory || {};

      function appendField(field, text) {
        var cur = String(ctx.character[field] || '');
        ctx.character[field] = cur ? (cur + '\n' + text) : text;
      }

      // Support both formats: context.character.* and append*
      if (t === 'context.character.personality' || t === 'appendPersonality') {
        if (a.mode === 'set') ctx.character.personality = txt;
        else appendField('personality', txt);
        return 'personality (' + (a.mode || 'append') + ')';
      }
      if (t === 'context.character.scenario' || t === 'appendScenario') {
        if (a.mode === 'set') ctx.character.scenario = txt;
        else appendField('scenario', txt);
        return 'scenario (' + (a.mode || 'append') + ')';
      }
      if (t === 'context.character.example_dialogs' || t === 'appendExampleDialogs') {
        if (a.mode === 'set') ctx.character.example_dialogs = txt;
        else appendField('example_dialogs', txt);
        return 'example_dialogs (' + (a.mode || 'append') + ')';
      }

      if (t === 'appendRandomFromList') {
        // Get list from appState
        var listId = String(a.listId || '');
        if (!listId) return '';

        // Find list in appState.lists
        var lists = isArr(appState.lists) ? appState.lists : [];
        var items = [];
        for (var i = 0; i < lists.length; i++) {
          if (lists[i] && String(lists[i].id || '') === listId) {
            items = isArr(lists[i].items) ? lists[i].items : [];
            break;
          }
        }

        if (!items.length) return '';

        // Pick random item
        var idx = Math.floor(Math.random() * items.length);
        var randomText = String(items[idx] || '');

        // Determine target field from a.target
        var targetField = 'personality';
        if (a.target === 'appendScenario' || a.target === 'context.character.scenario') {
          targetField = 'scenario';
        } else if (a.target === 'appendExampleDialogs' || a.target === 'context.character.example_dialogs') {
          targetField = 'example_dialogs';
        }

        appendField(targetField, randomText);
        return targetField + ' (random from list)';
      }

      if (t === 'memoryNumeric') {
        var n = parseFloat(txt);
        if (isNaN(n)) n = 0;
        var k = String(a.memKey || 'unnamed');
        var curNum = parseFloat(ctx.character.memory[k] || 0);
        if (isNaN(curNum)) curNum = 0;
        if (a.mode === 'add' || a.mode === 'append') ctx.character.memory[k] = curNum + n;
        else if (a.mode === 'subtract') ctx.character.memory[k] = curNum - n;
        else ctx.character.memory[k] = n;
        return 'memoryNumeric[' + k + '] (' + (a.mode || 'set') + ')';
      }

      if (t === 'memoryString') {
        var k2 = String(a.memKey || 'unnamed');
        var curStr = String(ctx.character.memory[k2] || '');
        if (a.mode === 'append') ctx.character.memory[k2] = curStr + txt;
        else ctx.character.memory[k2] = txt;
        return 'memoryString[' + k2 + '] (' + (a.mode || 'set') + ')';
      }

      return '';
    }

    // Derived values for this module
    env.derived = env.derived || {};
    var ders = isArr(appState.derived) ? appState.derived : [];
    var di;
    for (di = 0; di < ders.length; di++) {
      var d = ders[di];
      if (!d || !d.key || !d.listId) continue;
      var items = getList(d.listId);
      env.derived[d.key] = countInHistory(env.normHistory, items, d.windowSize || 10);
    }

    var hasIf = false;
    var hasElse = false;
    var chainTaken = false;

    var bi;
    for (bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi] || {};
      var type = String(b.type || 'if').toLowerCase();
      var join = String(b.join || 'and').toLowerCase() === 'or' ? 'OR' : 'AND';
      var conds = isArr(b.conditions) ? b.conditions : [];
      var ok = true;
      var i;

      if (type !== 'else') {
        var gateCounter = 1;
        var explanations = [];

        if (!conds.length) ok = true;
        else if (join === 'OR') {
          ok = false;
          for (i = 0; i < conds.length; i++) {
            var res = checkCond(conds[i], gateCounter++, true);
            if (res.explain) explanations.push(res.explain);
            if (res.ok) { ok = true; break; }
          }
        } else {
          ok = true;
          for (i = 0; i < conds.length; i++) {
            var res2 = checkCond(conds[i], gateCounter++, true);
            if (res2.explain) explanations.push(res2.explain);
            if (!res2.ok) { ok = false; break; }
          }
        }
      }

      var executed = false;
      if (type === 'if') {
        hasIf = true;
        hasElse = false;
        chainTaken = false;
        executed = !!ok;
        if (executed) chainTaken = true;
      } else if (type === 'elseif') {
        if (hasIf && !hasElse) {
          executed = !chainTaken && !!ok;
          if (executed) chainTaken = true;
        } else {
          hasIf = true;
          hasElse = false;
          chainTaken = false;
          executed = !!ok;
          if (executed) chainTaken = true;
        }
      } else { // else
        ok = true;
        if (hasIf && !hasElse) {
          executed = !chainTaken;
          hasElse = true;
          if (executed) chainTaken = true;
        } else {
          executed = true;
        }
      }

      var ran = [];
      if (executed) {
        var acts = isArr(b.actions) ? b.actions : [];
        var ai;
        for (ai = 0; ai < acts.length; ai++) {
          var note = applyAction(acts[ai]);
          if (note) ran.push(note);
        }
      }

      trace.push({
        idx: bi,
        type: type,
        label: b.label || '',
        ok: (type === 'else') ? null : ok,
        executed: executed,
        actions: ran,
        conditionCount: conds.length,
        join: join,
        explanations: (typeof explanations !== 'undefined') ? explanations : []
      });
    }

    return {
      personality: String(ctx.character.personality || ''),
      scenario: String(ctx.character.scenario || ''),
      memory: ctx.character.memory || {},
      derived: env.derived || {},
      trace: trace
    };
  }

  // ---------------------------
  // Page render
  // ---------------------------
  function render(rootEl) {
    var st;
    if (store && typeof store.ensureStudioState === 'function') {
      st = store.ensureStudioState();
    } else if (store && typeof store.load === 'function') {
      st = store.load();
    } else {
      st = root.StudioState || {};
    }
    st.data = st.data || {};
    st.data.sbx = st.data.sbx || {};
    st.data.sbx.modules = st.data.sbx.modules || {};
    st.data.sbx.lists = isArr(st.data.sbx.lists) ? st.data.sbx.lists : [];

    var sbxData = st.data.sbx;

    var metaModules = getModulesList();
    var moduleIds = [];
    var moduleLabels = {};
    var i;
    for (i = 0; i < metaModules.length; i++) {
      var m = metaModules[i] || {};
      var id = String(m.id || m.moduleId || '');
      if (!id || id === 'engine') continue;
      moduleIds.push(id);
      moduleLabels[id] = String(m.label || m.name || id);
    }

    var buildOrder = loadBuildOrder(moduleIds);
    var currentModuleId = ''; // empty = test all

    dom.empty(rootEl);

    var wrap = dom.el('div', { className: 'sbxA-page' });
    wrap.appendChild(dom.el('div', { className: 'sbxA-h2', text: 'Test Harness' }));
    wrap.appendChild(dom.el('div', {
      className: 'sbxA-sub',
      text: 'Simulate JanitorAI context against Advanced modules using the current Advanced config.'
    }));

    var grid = dom.el('div', {
      className: 'sbxA-grid2',
      style: 'display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:12px; position:relative;'
    });

    // Add visual divider between columns
    var divider = dom.el('div', {
      style: 'position:absolute; left:50%; top:0; bottom:0; width:1px; background:linear-gradient(to bottom, transparent, var(--border) 10%, var(--border) 90%, transparent); pointer-events:none;'
    });
    grid.appendChild(divider);

    // LEFT: inputs
    var left = dom.el('div', {
      className: 'sbxA-card',
      style: 'border:1px solid var(--border); border-radius:12px; padding:16px; background:rgba(255,255,255,0.02); box-shadow:0 2px 8px rgba(0,0,0,0.3);'
    });
    left.appendChild(dom.el('div', {
      className: 'sbxA-h3',
      style: 'margin-top:0; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border);',
      text: 'Inputs'
    }));

    // Module selector
    var modRow = dom.el('div', {
      className: 'sbxA-row wrap',
      style: 'margin-top:4px; align-items:center;'
    });
    modRow.appendChild(dom.el('div', { className: 'sbxA-lab', text: 'Modules to test' }));

    var selModule = dom.el('select', {
      className: 'inp',
      style: 'margin-left:6px; min-width:200px;'
    });

    // First option: all modules
    selModule.appendChild(dom.el('option', {
      attrs: { value: '' },
      text: moduleIds.length ? '(All modules, Engine order)' : '(no Advanced modules found)'
    }));

    for (i = 0; i < moduleIds.length; i++) {
      var mid = moduleIds[i];
      selModule.appendChild(dom.el('option', {
        attrs: { value: mid },
        text: moduleLabels[mid] || mid
      }));
    }

    selModule.onchange = function () {
      currentModuleId = selModule.value || '';
    };

    modRow.appendChild(selModule);
    left.appendChild(modRow);

    // Run button at the TOP of the inputs for accessibility
    var btnRun = dom.el('button', {
      className: 'btn btn-primary',
      text: 'Run Test',
      style: 'width:100%; margin:12px 0; padding:12px; font-size:14px;'
    });
    left.appendChild(btnRun);

    // ===== CHARACTER SECTION =====
    left.appendChild(dom.el('div', {
      className: 'sbxA-h4',
      style: 'margin-top:16px; margin-bottom:8px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; font-size:11px; border-bottom:1px solid var(--border); padding-bottom:4px;',
      text: 'CHARACTER'
    }));

    // Character Name and Chat Name (compact row)
    var compactRow1 = dom.el('div', {
      style: 'display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px;'
    });

    var nameCol = dom.el('div');
    nameCol.appendChild(dom.el('div', { className: 'sbxA-lab', text: 'Character Name' }));
    var inpCharName = dom.el('input', {
      className: 'inp',
      attrs: { type: 'text', placeholder: 'e.g. Luna' }
    });
    nameCol.appendChild(inpCharName);

    var chatNameCol = dom.el('div');
    chatNameCol.appendChild(dom.el('div', { className: 'sbxA-lab', text: 'Chat Name' }));
    var inpChatName = dom.el('input', {
      className: 'inp',
      attrs: { type: 'text', placeholder: 'e.g. Conversation with Luna' }
    });
    chatNameCol.appendChild(inpChatName);

    compactRow1.appendChild(nameCol);
    compactRow1.appendChild(chatNameCol);
    left.appendChild(compactRow1);

    // Personality
    left.appendChild(dom.el('div', { className: 'sbxA-lab', style: 'margin-top:8px;', text: 'Personality' }));
    var inpP = dom.el('textarea', {
      className: 'inp sbxA-ta',
      attrs: { rows: 3, placeholder: 'Initial personality (optional)' }
    });
    left.appendChild(inpP);

    // Scenario
    left.appendChild(dom.el('div', { className: 'sbxA-lab', text: 'Scenario' }));
    var inpS = dom.el('textarea', {
      className: 'inp sbxA-ta',
      attrs: { rows: 3, placeholder: 'Initial scenario (optional)' }
    });
    left.appendChild(inpS);

    // Example Dialogs
    left.appendChild(dom.el('div', { className: 'sbxA-lab', text: 'Example Dialogs' }));
    var inpExampleDialogs = dom.el('textarea', {
      className: 'inp sbxA-ta',
      attrs: { rows: 2, placeholder: 'Example dialogs (optional)' }
    });
    left.appendChild(inpExampleDialogs);

    // ===== CHAT SECTION =====
    left.appendChild(dom.el('div', {
      className: 'sbxA-h4',
      style: 'margin-top:16px; margin-bottom:8px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; font-size:11px; border-bottom:1px solid var(--border); padding-bottom:4px;',
      text: 'CHAT'
    }));

    // User Name and Persona Name (compact row)
    var compactRow2 = dom.el('div', {
      style: 'display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px;'
    });

    var userCol = dom.el('div');
    userCol.appendChild(dom.el('div', { className: 'sbxA-lab', text: 'User Name' }));
    var inpUserName = dom.el('input', {
      className: 'inp',
      attrs: { type: 'text', placeholder: 'e.g. Alex' }
    });
    userCol.appendChild(inpUserName);

    var personaCol = dom.el('div');
    personaCol.appendChild(dom.el('div', { className: 'sbxA-lab', text: 'Persona Name' }));
    var inpPersonaName = dom.el('input', {
      className: 'inp',
      attrs: { type: 'text', placeholder: 'e.g. Traveler' }
    });
    personaCol.appendChild(inpPersonaName);

    compactRow2.appendChild(userCol);
    compactRow2.appendChild(personaCol);
    left.appendChild(compactRow2);

    // ===== MESSAGES SECTION =====
    left.appendChild(dom.el('div', {
      className: 'sbxA-h4',
      style: 'margin-top:16px; margin-bottom:8px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; font-size:11px; border-bottom:1px solid var(--border); padding-bottom:4px;',
      text: 'MESSAGES'
    }));

    // Message count override
    left.appendChild(dom.el('div', {
      className: 'sbxA-lab',
      style: 'margin-top:8px;',
      text: 'Override message count (optional)'
    }));
    var inpMsgCount = dom.el('input', {
      className: 'inp',
      attrs: { type: 'number', min: '0', placeholder: '(auto from history length)' },
      style: 'max-width:180px;'
    });
    left.appendChild(inpMsgCount);

    // Message history (rows)
    left.appendChild(dom.el('div', {
      className: 'sbxA-lab',
      style: 'margin-top:8px;',
      text: 'Message history (top is oldest, bottom is newest)'
    }));

    var msgWrap = dom.el('div', { id: 'sbx-test-msgs' });
    left.appendChild(msgWrap);

    function refreshMsgIndices() {
      var rows = msgWrap.getElementsByClassName('sbxTest-msgRow');
      var i;
      for (i = 0; i < rows.length; i++) {
        var idxEl = rows[i].getElementsByClassName('sbxTest-msgIndex')[0];
        if (idxEl) idxEl.textContent = '#' + (i + 1);
      }
    }

    function addMsgRow(text) {
      var row = dom.el('div', {
        className: 'sbxA-row sbxTest-msgRow wrap',
        style: 'margin-top:6px; align-items:flex-start;'
      });

      var idxLabel = dom.el('div', {
        className: 'sbxTest-msgIndex',
        style: 'width:32px; font-size:11px; padding-top:4px; text-align:right;',
        text: '#?'
      });

      var ta = dom.el('textarea', {
        className: 'inp sbxA-ta sbxTest-msgText',
        attrs: { rows: 2, placeholder: 'Message text' },
        style: 'flex:1; margin-left:6px;'
      });
      ta.value = text || '';

      var delBtn = dom.el('button', {
        className: 'btn btn-ghost',
        text: 'Delete',
        style: 'margin-left:6px;'
      });
      delBtn.onclick = function () {
        if (row && row.parentNode === msgWrap) {
          msgWrap.removeChild(row);
          refreshMsgIndices();
        }
      };

      row.appendChild(idxLabel);
      row.appendChild(ta);
      row.appendChild(delBtn);

      msgWrap.appendChild(row);
      refreshMsgIndices();
    }

    var addMsgBtn = dom.el('button', {
      className: 'btn btn-ghost',
      text: 'Add Message'
    });
    addMsgBtn.onclick = function () {
      addMsgRow('');
    };

    // Start with two blank messages to encourage a small history
    addMsgRow('');
    addMsgRow('');

    left.appendChild(dom.el('div', {
      className: 'sbxA-row',
      style: 'margin-top:6px;'
    }, [addMsgBtn]));

    left.appendChild(dom.el('div', {
      className: 'sbxA-row',
      style: 'margin-top:6px;'
    }, [addMsgBtn]));

    // RIGHT: output
    var right = dom.el('div', {
      className: 'sbxA-card',
      style: 'border:1px solid var(--border); border-radius:12px; padding:16px; background:rgba(255,255,255,0.02); box-shadow:0 2px 8px rgba(0,0,0,0.3);'
    });
    right.appendChild(dom.el('div', {
      className: 'sbxA-h3',
      style: 'margin-top:0; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border);',
      text: 'Results'
    }));

    var outSummary = dom.el('div', { className: 'sbxA-muted', style: 'margin-bottom:6px;', text: 'Run a test to see module flow and final state.' });

    var pre = dom.el('pre', {
      className: 'sbxA-pre',
      style: 'white-space:pre-wrap; font-size:11px; max-height:calc(100vh - 200px); overflow-y:auto;',
      text: '(no run yet)'
    });

    right.appendChild(outSummary);
    right.appendChild(pre);

    // Add both panels to grid
    grid.appendChild(left);
    grid.appendChild(right);

    // Add grid to wrapper
    wrap.appendChild(grid);
    rootEl.appendChild(wrap);

    // Run logic
    btnRun.onclick = function () {
      var ctx = {
        character: {
          name: String(inpCharName.value || ''),
          chat_name: String(inpChatName.value || ''),
          personality: String(inpP.value || ''),
          scenario: String(inpS.value || ''),
          example_dialogs: String(inpExampleDialogs.value || ''),
          memory: {}
        },
        chat: {
          user_name: String(inpUserName.value || ''),
          persona_name: String(inpPersonaName.value || '')
        }
      };

      // Gather messages from DOM
      var rows = msgWrap.getElementsByClassName('sbxTest-msgRow');
      var msgs = [];
      var normHistory = [];
      var lastUser = '';
      var i;
      for (i = 0; i < rows.length; i++) {
        var ta = rows[i].getElementsByClassName('sbxTest-msgText')[0];
        if (!ta) continue;
        var text = String(ta.value || '');
        if (!text.replace(/\s+/g, '')) continue;
        msgs.push(text);
        normHistory.push(normalize(text));
        lastUser = text; // treat all as user messages for now
      }

      ctx.chat.last_messages = msgs.slice(0);
      ctx.chat.last_message = msgs.length ? msgs[msgs.length - 1] : '';
      ctx.chat.chat_metadata = { public_message_count: msgs.length };

      var msgOverride = parseInt(inpMsgCount.value, 10);
      var msgCount = (!isNaN(msgOverride) && msgOverride > 0) ? msgOverride : msgs.length;

      var env = {
        context: ctx,
        lastUserMsg: lastUser || ctx.chat.last_message,
        normHistory: normHistory,
        messageCount: msgCount,
        derived: {}
      };

      var lists = sbxData.lists || [];

      // Determine which modules to run
      var runModules = [];
      if (!currentModuleId) {
        // All modules, Engine order
        var j;
        for (j = 0; j < buildOrder.length; j++) {
          if (moduleLabels[buildOrder[j]]) runModules.push(buildOrder[j]);
        }
      } else {
        runModules.push(currentModuleId);
      }

      if (!runModules.length) {
        pre.textContent = 'No Advanced modules found. Open a module in the Advanced editor to initialize it, then try again.';
        return;
      }

      var moduleResults = [];
      var m;
      for (m = 0; m < runModules.length; m++) {
        var mid = runModules[m];
        var mLabel = moduleLabels[mid] || mid;
        var modData = sbxData.modules[mid] || {};
        var appState = {
          lists: lists,
          derived: (modData.appState && isArr(modData.appState.derived)) ? modData.appState.derived : [],
          blocks: (modData.appState && isArr(modData.appState.blocks)) ? modData.appState.blocks : []
        };

        var res = evalRun(appState, env);
        // env/context mutated inside evalRun, so next module sees updated state
        env.context = {
          character: {
            personality: res.personality,
            scenario: res.scenario,
            example_dialogs: ctx.character.example_dialogs,
            memory: res.memory
          },
          chat: ctx.chat
        };
        ctx = env.context;

        moduleResults.push({
          id: mid,
          label: mLabel,
          res: res
        });
      }

      // Compose human-readable output
      var lines = [];
      lines.push('=== Modules run ===');
      for (i = 0; i < moduleResults.length; i++) {
        lines.push('- ' + moduleResults[i].label + ' (' + moduleResults[i].id + ')');
      }
      lines.push('');

      // Derived values per module
      lines.push('=== Derived values per module ===');
      for (i = 0; i < moduleResults.length; i++) {
        var mr = moduleResults[i];
        lines.push('[' + mr.label + ']');
        var has = false;
        var k;
        for (k in mr.res.derived) {
          if (!mr.res.derived.hasOwnProperty(k)) continue;
          has = true;
          lines.push('  ' + k + ' = ' + mr.res.derived[k]);
        }
        if (!has) lines.push('  (none)');
        lines.push('');
      }

      // Trace
      lines.push('=== Block trace ===');
      for (i = 0; i < moduleResults.length; i++) {
        var mr2 = moduleResults[i];
        lines.push('[' + mr2.label + ']');
        if (!mr2.res.trace.length) {
          lines.push('  (no blocks to evaluate)');
          lines.push('');
          continue;
        }
        var tIdx;
        for (tIdx = 0; tIdx < mr2.res.trace.length; tIdx++) {
          var tr = mr2.res.trace[tIdx];
          var line =
            '  #' + (tr.idx + 1) + ': ' +
            String(tr.type || '').toUpperCase() +
            (tr.label ? (' [' + tr.label + ']') : '') +
            ' → ' +
            (tr.executed ? 'FIRED' : 'skipped');

          // Add condition details
          if (tr.type !== 'else' && typeof tr.conditionCount === 'number' && tr.conditionCount > 0) {
            line += ' (' + tr.conditionCount + ' condition(s), join: ' + (tr.join || 'AND') + ')';
          }

          lines.push(line);

          // Add detailed gate explanations
          if (tr.explanations && tr.explanations.length) {
            for (var e = 0; e < tr.explanations.length; e++) {
              var explainLines = String(tr.explanations[e]).split('\n');
              for (var el = 0; el < explainLines.length; el++) {
                lines.push('    ' + explainLines[el]);
              }
            }
            lines.push('    Result: ' + (tr.ok ? 'PASSED' : 'FAILED'));
          }

          if (tr.actions && tr.actions.length) {
            lines.push('    Actions: ' + tr.actions.join(', '));
          }
        }
        lines.push('');
      }

      // Final state
      lines.push('=== Final Personality ===');
      lines.push(ctx.character.personality || '(empty)');
      lines.push('');
      lines.push('=== Final Scenario ===');
      lines.push(ctx.character.scenario || '(empty)');
      lines.push('');
      lines.push('=== Final Memory ===');
      try {
        lines.push(JSON.stringify(ctx.character.memory || {}, null, 2));
      } catch (_e3) {
        lines.push(String(ctx.character.memory || {}));
      }

      pre.textContent = lines.join('\n');
      outSummary.textContent = 'Ran ' + moduleResults.length + ' module(s); scroll for block-by-block explanation.';
    };
  }

  SBX.pages.test.render = render;
})(window);

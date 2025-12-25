(function (root) {
  'use strict';

  var SBX = root.SBX = root.SBX || {};
  SBX.TestRunner = SBX.TestRunner || {};

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function toStr(x) { return String(x == null ? '' : x); }

  function compare(op, left, right) {
    if (op === '>=') return left >= right;
    if (op === '>') return left > right;
    if (op === '==') return left == right; // eslint-disable-line eqeqeq
    if (op === '!=') return left != right; // eslint-disable-line eqeqeq
    if (op === '<=') return left <= right;
    if (op === '<') return left < right;
    return false;
  }

  function getListItems(appState, listId) {
    var lists = (appState && appState.lists) ? appState.lists : [];
    for (var i = 0; i < lists.length; i++) {
      if (lists[i] && lists[i].id === listId) return lists[i].items || [];
    }
    return [];
  }

  function anyInList(text, list) {
    text = toStr(text).toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var needle = toStr(list[i]).toLowerCase();
      if (!needle) continue;
      if (text.indexOf(needle) !== -1) return true;
    }
    return false;
  }

  function anyInListNegation(text, list) {
    // same approach you had: only counts matches not preceded by a negation word “nearby”
    text = toStr(text).toLowerCase();
    var negs = ["not", "no", "never", "don't", "dont", "won't", "wont", "can't", "cant", "without"];

    for (var i = 0; i < list.length; i++) {
      var needle = toStr(list[i]).toLowerCase();
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

  function countMatchesInHistory(normHistory, list, windowSize) {
    var len = normHistory.length;
    var start = 0;
    if (windowSize && windowSize > 0 && windowSize < len) start = len - windowSize;

    var count = 0;
    for (var i = start; i < len; i++) {
      if (anyInList(normHistory[i], list)) count++;
    }
    return count;
  }

  function computeDerived(appState, env) {
    var out = {};
    var derived = (appState && appState.derived) ? appState.derived : [];
    for (var i = 0; i < derived.length; i++) {
      var d = derived[i];
      if (!d || !d.key || !d.listId) continue;

      var items = getListItems(appState, d.listId);
      var win = (typeof d.windowSize === 'number') ? d.windowSize : parseInt(d.windowSize, 10);
      if (isNaN(win) || win <= 0) win = 10;

      out[d.key] = countMatchesInHistory(env.normHistory, items, win);
    }
    return out;
  }

  function applyAction(action, ctx, ran) {
    if (!action) return;

    ctx.character = ctx.character || {};
    ctx.character.memory = ctx.character.memory || {};

    function note(s) { ran.push(s); }

    var t = toStr(action.type);
    var text = toStr(action.text);

    if (t === 'appendPersonality' || t === 'appendScenario' || t === 'appendExampleDialogs') {
      var field = (t === 'appendPersonality') ? 'personality' : (t === 'appendScenario' ? 'scenario' : 'example_dialogs');
      var cur = toStr(ctx.character[field]);
      ctx.character[field] = cur ? (cur + "\n" + text) : text;
      note(field + ' append');
      return;
    }

    if (t === 'appendRandomFromList') {
      var listId = toStr(action.listId);
      var items = getListItems(root.StudioState && root.StudioState.data && root.StudioState.data.sitebuilderx ? root.StudioState.data.sitebuilderx.appState : null, listId);
      // if StudioState isn't available in tests, caller should pass appState-local lists; we’ll handle that in run()
      if (!items || !items.length) { note('appendRandomFromList (empty)'); return; }

      var idx = Math.floor(Math.random() * items.length);
      var choice = toStr(items[idx]);

      var tgtRaw = toStr(action.target || 'appendPersonality');
      var field2 = (tgtRaw === 'appendScenario') ? 'scenario' : ((tgtRaw === 'appendExampleDialogs') ? 'example_dialogs' : 'personality');

      var cur2 = toStr(ctx.character[field2]);
      ctx.character[field2] = cur2 ? (cur2 + "\n" + choice) : choice;
      note(field2 + ' append (random)');
      return;
    }

    if (t === 'memoryNumeric' || t === 'memoryString') {
      var key = toStr(action.memKey || 'unnamed');
      var mode = toStr(action.mode || 'set');

      if (t === 'memoryNumeric') {
        var n = parseFloat(text);
        if (isNaN(n)) n = 0;
        if (mode === 'append') ctx.character.memory[key] = Number(ctx.character.memory[key] || 0) + n;
        else ctx.character.memory[key] = n;
        note('memoryNumeric[' + key + '] ' + mode);
      } else {
        if (mode === 'append') {
          var curm = toStr(ctx.character.memory[key]);
          ctx.character.memory[key] = curm ? (curm + "\n" + text) : text;
        } else {
          ctx.character.memory[key] = text;
        }
        note('memoryString[' + key + '] ' + mode);
      }
    }
  }

  function evalLeaf(node, env) {
    var t = toStr(node.type);
    var ok = true;
    var lines = [];

    function push(s) { lines.push(s); }

    var op = toStr(node.op || '>=');
    var thr = (typeof node.threshold === 'number') ? node.threshold : parseFloat(node.threshold);
    if (isNaN(thr)) thr = 0;

    if (t === 'randomChance') {
      var roll = Math.random() * 100;
      ok = (roll < thr);
      push('Random roll ' + roll.toFixed(2) + '% < ' + thr + '% => ' + (ok ? 'PASS' : 'FAIL'));
    }
    else if (t === 'messageCountComparison') {
      var mc = env.messageCount || 0;
      if (op === 'every') {
        ok = (mc > 0 && thr > 0 && (mc % thr === 0));
        push('MessageCount ' + mc + ' every ' + thr + ' => ' + (ok ? 'PASS' : 'FAIL'));
      } else {
        ok = compare(op, mc, thr);
        push('MessageCount ' + mc + ' ' + op + ' ' + thr + ' => ' + (ok ? 'PASS' : 'FAIL'));
      }
    }
    else if (t === 'anyInList' || t === 'noneInList') {
      var items = getListItems(env.appState, node.listId);
      var targetText = (node.source === 'normHistory') ? env.normHistory.join('\n') : env.normLastUserMsg;

      var match;
      if (node.negationGuard && t === 'anyInList') match = anyInListNegation(targetText, items);
      else match = anyInList(targetText, items);

      ok = (t === 'anyInList') ? !!match : !match;

      push((t === 'anyInList' ? 'AnyInList' : 'NoneInList') + ' => ' + (ok ? 'PASS' : 'FAIL'));
    }
    else if (t === 'countInHistory' || t === 'historyContainsList') {
      var win = (typeof node.windowSize === 'number') ? node.windowSize : parseInt(node.windowSize, 10);
      if (isNaN(win) || win <= 0) win = 8;

      var items2 = getListItems(env.appState, node.listId);
      var cnt = countMatchesInHistory(env.normHistory, items2, win);

      ok = compare(op, cnt, thr);
      push('CountInHistory last ' + win + ' => ' + cnt + ' needs ' + op + ' ' + thr + ' => ' + (ok ? 'PASS' : 'FAIL'));
    }
    else if (t === 'derivedNumberComparison') {
      var dk = toStr(node.derivedKey);
      var dv = Number((env.derived && env.derived[dk]) || 0);
      ok = compare(op, dv, thr);
      push('Derived[' + dk + '] ' + dv + ' ' + op + ' ' + thr + ' => ' + (ok ? 'PASS' : 'FAIL'));
    }
    else if (t === 'memoryNumberComparison') {
      var mk = toStr(node.memKey);
      var mv = Number((env.context.character.memory && env.context.character.memory[mk]) || 0);
      ok = compare(op, mv, thr);
      push('MemoryNum[' + mk + '] ' + mv + ' ' + op + ' ' + thr + ' => ' + (ok ? 'PASS' : 'FAIL'));
    }
    else if (t === 'memoryStringContains') {
      var mk2 = toStr(node.memKey);
      var s2 = toStr(env.context.character.memory && env.context.character.memory[mk2]);
      var needle = toStr(node.text);
      ok = (node.caseInsensitive !== false)
        ? (s2.toLowerCase().indexOf(needle.toLowerCase()) !== -1)
        : (s2.indexOf(needle) !== -1);
      push('MemoryStr[' + mk2 + '] contains "' + needle + '" => ' + (ok ? 'PASS' : 'FAIL'));
    }
    else if (t === 'personalityContains' || t === 'scenarioContains') {
      var field = (t === 'personalityContains') ? 'personality' : 'scenario';
      var hay = toStr(env.context.character[field]);
      var needle2 = toStr(node.text);
      ok = (node.caseInsensitive !== false)
        ? (hay.toLowerCase().indexOf(needle2.toLowerCase()) !== -1)
        : (hay.indexOf(needle2) !== -1);
      push(field + ' contains "' + needle2 + '" => ' + (ok ? 'PASS' : 'FAIL'));
    }
    else {
      ok = true;
      push('Unknown condition "' + t + '" treated as PASS');
    }

    if (node.not) {
      ok = !ok;
      push('NOT applied => ' + (ok ? 'PASS' : 'FAIL'));
    }

    return { ok: ok, lines: lines };
  }

  function evalNode(node, env, gateCounter) {
    if (!node) return { ok: true, lines: [] };

    // group
    if (node.nodeType === 'group') {
      var join = (toStr(node.join).toLowerCase() === 'or') ? 'or' : 'and';
      var items = isArr(node.items) ? node.items : [];

      var allLines = [];
      var results = [];

      for (var i = 0; i < items.length; i++) {
        var r = evalNode(items[i], env, gateCounter);
        results.push(!!r.ok);
        for (var j = 0; j < r.lines.length; j++) allLines.push(r.lines[j]);
      }

      var ok = true;
      if (!items.length) {
        ok = true;
        allLines.push('Group(' + join.toUpperCase() + '): empty => PASS');
      } else if (join === 'or') {
        ok = false;
        for (i = 0; i < results.length; i++) if (results[i]) { ok = true; break; }
        allLines.push('Group(OR): any pass => ' + (ok ? 'PASS' : 'FAIL'));
      } else {
        ok = true;
        for (i = 0; i < results.length; i++) if (!results[i]) { ok = false; break; }
        allLines.push('Group(AND): all pass => ' + (ok ? 'PASS' : 'FAIL'));
      }

      if (node.not) {
        ok = !ok;
        allLines.push('Group NOT applied => ' + (ok ? 'PASS' : 'FAIL'));
      }

      return { ok: ok, lines: allLines };
    }

    // leaf
    gateCounter.n++;
    var leaf = evalLeaf(node, env);
    var pref = 'Gate ' + gateCounter.n + ': ';
    for (var k = 0; k < leaf.lines.length; k++) leaf.lines[k] = pref + leaf.lines[k];
    return leaf;
  }

  function evalBlock(block, env, gateCounter) {
    if (!block) return { ok: true, lines: [] };
    if (block.type === 'else') return { ok: true, lines: [] };

    var join = (toStr(block.join).toUpperCase() === 'OR') ? 'or' : 'and';
    var conds = isArr(block.conditions) ? block.conditions : [];

    if (!conds.length) return { ok: true, lines: ['(no conditions) => PASS'] };

    var allLines = [];
    var anyPass = false;
    var allPass = true;

    for (var i = 0; i < conds.length; i++) {
      var r = evalNode(conds[i], env, gateCounter);
      for (var j = 0; j < r.lines.length; j++) allLines.push(r.lines[j]);

      if (r.ok) anyPass = true;
      if (!r.ok) allPass = false;
    }

    var ok = (join === 'or') ? anyPass : allPass;
    allLines.push('Join(' + join.toUpperCase() + ') => ' + (ok ? 'PASS' : 'FAIL'));
    return { ok: ok, lines: allLines };
  }

  function run(appState, ctx, options) {
    options = options || {};
    appState = appState || { lists: [], derived: [], blocks: [] };

    // env is produced from TestCore (if present)
    var env = (SBX.TestCore && SBX.TestCore.buildEnv)
      ? SBX.TestCore.buildEnv(appState, ctx)
      : { appState: appState, context: ctx, messageCount: 0, normLastUserMsg: '', normHistory: [] };

    // derived
    env.derived = computeDerived(appState, env);

    // patch appendRandomFromList list lookup to use appState lists during tests
    // (if StudioState isn't present)
    var originalGetListItems = getListItems;
    function getListItemsLocal(_unused, listId) { return originalGetListItems(appState, listId); }

    // block execution with IF/ELSEIF/ELSE chaining
    var blocks = isArr(appState.blocks) ? appState.blocks : [];
    var gateCounter = { n: 0 };

    var lines = [];
    lines.push('=== Derived ===');
    var anyD = false;
    for (var dk in env.derived) { anyD = true; lines.push(dk + ': ' + env.derived[dk]); }
    if (!anyD) lines.push('(none)');

    lines.push('');
    lines.push('=== Trace ===');

    var chainTaken = false;
    var inChain = false;
    var chainHasElse = false;

    var anyExecuted = false;
    var ranAny = false;

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i] || {};
      var btype = toStr(b.type || 'if');

      if (btype === 'if') { inChain = true; chainTaken = false; chainHasElse = false; }
      else if (!inChain) { inChain = true; chainTaken = false; chainHasElse = false; } // tolerate

      var explain = (btype === 'else') ? { ok: true, lines: [] } : evalBlock(b, env, gateCounter);
      var condOk = (btype === 'else') ? true : !!explain.ok;

      var eligible = true;
      if (btype === 'elseif' || btype === 'else') eligible = !chainTaken;
      if (btype === 'else' && chainHasElse) eligible = false;

      var executed = false;
      if (eligible) {
        if (btype === 'else') executed = true;
        else executed = condOk;
      }

      if (executed) { anyExecuted = true; chainTaken = true; }
      if (btype === 'else') chainHasElse = true;

      lines.push(
        (i + 1) + '. ' + btype.toUpperCase() +
        (b.label ? (' [' + b.label + ']') : '') +
        ' | eligible=' + (eligible ? 'YES' : 'no') +
        ' | cond=' + (btype === 'else' ? 'n/a' : (condOk ? 'PASS' : 'FAIL')) +
        ' | exec=' + (executed ? 'YES' : 'no')
      );

      if (btype !== 'else') {
        for (var j = 0; j < explain.lines.length; j++) lines.push('   ' + explain.lines[j]);
      }

      if (executed && isArr(b.actions)) {
        var ran = [];
        // temporarily override list lookup for random action
        var oldStudio = root.StudioState;
        if (!oldStudio) {
          // install minimal StudioState so th action path doesn't explode
          root.StudioState = { data: { sitebuilderx: { appState: appState } } };
        }

        for (var a = 0; a < b.actions.length; a++) applyAction(b.actions[a], ctx, ran);
        if (ran.length) { ranAny = true; lines.push('   ACT: ' + ran.join('; ')); }

        // restore
        if (!oldStudio) root.StudioState = oldStudio;
      }
    }

    lines.push('');
    if (!anyExecuted) lines.push('Output -> No blocks executed.');
    else if (!ranAny) lines.push('Output -> Blocks executed but no actions produced.');
    else lines.push('Output -> Actions produced.');

    lines.push('');
    lines.push('=== Final Personality ===');
    lines.push(toStr(ctx.character.personality));
    lines.push('');
    lines.push('=== Final Scenario ===');
    lines.push(toStr(ctx.character.scenario));
    lines.push('');
    lines.push('=== Final Example Dialogs ===');
    lines.push(toStr(ctx.character.example_dialogs));
    lines.push('');
    lines.push('=== Final Memory ===');
    lines.push(JSON.stringify(ctx.character.memory || {}, null, 2));

    return {
      env: env,
      log: lines.join('\n'),
      context: ctx
    };
  }

  SBX.TestRunner.run = run;

})(window);

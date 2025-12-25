(function (root) {
  'use strict';

  var SBX = root.SBX = root.SBX || {};
  SBX.Codegen = SBX.Codegen || {};

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function validate(appState) {
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
        if (hasElse) msgs.push('Multiple ELSE blocks in the same chain near ' + lbl + '.');
        hasElse = true;
      }
      if ((b.type === 'if' || b.type === 'elseif') && (!b.conditions || !b.conditions.length)) {
        msgs.push("IF/ELSE IF block '" + lbl + "' has no conditions; it will always be true.");
      }
      if (!b.actions || !b.actions.length) msgs.push("Block '" + lbl + "' has no actions.");
    }
    return msgs;
  }

  // --- expression helpers ---
  function condExpr(c) {
    if (!c) return 'true';
    var t = String(c.type || '');
    var op = String(c.op || '>=');

    var safeOps = { '>': 1, '>=': 1, '<': 1, '<=': 1, '==': 1, '!=': 1, 'every': 1 };
    if (!safeOps[op]) op = '>=';

    var th = parseFloat(c.threshold);
    if (isNaN(th)) th = 0;

    if (t === 'randomChance') return '(Math.random() * 100 < ' + th + ')';

    if (t === 'messageCountComparison') {
      if (op === 'every') return '((__sbx_msgCount() % ' + th + ') === 0 && __sbx_msgCount() > 0)';
      return '(__sbx_msgCount() ' + op + ' ' + th + ')';
    }

    if (t === 'anyInList' || t === 'noneInList') {
      var lid = String(c.listId || '');
      if (!lid) return (t === 'noneInList') ? 'true' : 'false';
      var src = (c.source === 'normHistory') ? '__sbx_norm_history(__sbx_last_messages(), 50)' : '__sbx_norm(__sbx_last_message())';
      if (c.negationGuard && t === 'anyInList') return '__sbx_listAnyNegation(' + lid + ', ' + src + ')';
      var check = '__sbx_listAny(' + lid + ', ' + src + ')';
      return (t === 'noneInList') ? ('!' + check) : check;
    }

    if (t === 'countInHistory' || t === 'historyContainsList') {
      var lid2 = String(c.listId || '');
      var ws = parseInt(c.windowSize, 10);
      if (isNaN(ws) || ws <= 0) ws = 8;
      if (!lid2) return 'false';
      return '(__sbx_countMatches(__sbx_norm_history(__sbx_last_messages(), 50), ' + lid2 + ', ' + ws + ') ' + op + ' ' + th + ')';
    }

    if (t === 'derivedNumberComparison') {
      var dk = JSON.stringify(String(c.derivedKey || ''));
      return '((derived[' + dk + '] || 0) ' + op + ' ' + th + ')';
    }

    if (t === 'memoryNumberComparison') {
      var mk = JSON.stringify(String(c.memKey || ''));
      return '((context.character.memory && parseFloat(context.character.memory[' + mk + ']) || 0) ' + op + ' ' + th + ')';
    }

    if (t === 'personalityContains' || t === 'scenarioContains') {
      var txt = JSON.stringify(String(c.text || '').toLowerCase());
      var target = (t === 'personalityContains') ? '(context.character.personality || "")' : '(context.character.scenario || "")';
      return '(' + target + '.toLowerCase().indexOf(' + txt + ') !== -1)';
    }

    return 'true';
  }

  function condNodeExpr(node) {
    if (!node) return 'true';

    if (node.nodeType === 'group') {
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

  function generate(appState) {
    appState = appState || { lists: [], derived: [], blocks: [] };

    var lines = [];
    var msgs = validate(appState);
    if (msgs.length) {
      lines.push('//');
      lines.push('// WARNINGS:');
      for (var w = 0; w < msgs.length; w++) lines.push('// - ' + msgs[w]);
      lines.push('//');
      lines.push('');
    }

    lines.push('// Generated by ScriptBuilder X');
    lines.push('');

    // Lists
    if (appState.lists && appState.lists.length) {
      for (var i = 0; i < appState.lists.length; i++) {
        var list = appState.lists[i] || {};
        if (!list.id) continue;
        lines.push('var ' + list.id + ' = ' + JSON.stringify(list.items || []) + ';');
      }
      lines.push('');
    }

    // Helpers
    lines.push('function __sbx_norm(s){ s = String(s==null?"":s); return s.toLowerCase(); }');
    lines.push('function __sbx_last_messages(){');
    lines.push('  var a = (context && context.chat && context.chat.last_messages) ? context.chat.last_messages : [];');
    lines.push('  if (!a || !a.length) return [];');
    lines.push('  // accept array of {message} or plain strings');
    lines.push('  var out = [];');
    lines.push('  for (var i=0;i<a.length;i++){');
    lines.push('    var v = a[i];');
    lines.push('    out.push(typeof v==="string" ? v : (v && v.message ? v.message : ""));');
    lines.push('  }');
    lines.push('  return out;');
    lines.push('}');
    lines.push('function __sbx_last_message(){ var a=__sbx_last_messages(); return a.length?String(a[a.length-1]||""):""; }');
    lines.push('function __sbx_msgCount(){ var a=__sbx_last_messages(); return a.length||0; }');
    lines.push('function __sbx_norm_history(arr, maxN){');
    lines.push('  var out=[]; if(!arr) return out;');
    lines.push('  var start=0; if(typeof maxN==="number"&&maxN>0&&arr.length>maxN) start=arr.length-maxN;');
    lines.push('  for(var i=start;i<arr.length;i++) out.push(__sbx_norm(arr[i]));');
    lines.push('  return out;');
    lines.push('}');
    lines.push('function __sbx_countMatches(normHistory, list, windowSize){');
    lines.push('  list=list||[]; var start=0;');
    lines.push('  if(typeof windowSize==="number"&&windowSize>0&&normHistory.length>windowSize) start=normHistory.length-windowSize;');
    lines.push('  var count=0;');
    lines.push('  for(var i=start;i<normHistory.length;i++){');
    lines.push('    var msg=normHistory[i]||"";');
    lines.push('    for(var j=0;j<list.length;j++){');
    lines.push('      var kw=__sbx_norm(list[j]); if(kw && msg.indexOf(kw)!==-1){ count++; break; }');
    lines.push('    }');
    lines.push('  }');
    lines.push('  return count;');
    lines.push('}');
    lines.push('function __sbx_listAny(list,target){');
    lines.push('  if(!list||!list.length) return false;');
    lines.push('  if(typeof target==="string"){ var t=__sbx_norm(target);');
    lines.push('    for(var i=0;i<list.length;i++) if(t.indexOf(__sbx_norm(list[i]))!==-1) return true;');
    lines.push('  } else if (target && target.length){');
    lines.push('    for(var a=0;a<target.length;a++){ var msg=String(target[a]||"");');
    lines.push('      for(var j=0;j<list.length;j++) if(__sbx_norm(msg).indexOf(__sbx_norm(list[j]))!==-1) return true;');
    lines.push('    }');
    lines.push('  }');
    lines.push('  return false;');
    lines.push('}');
    lines.push('function __sbx_listAnyNegation(list,target){');
    lines.push('  if(!list||!list.length) return false;');
    lines.push('  var tVals=[]; if(typeof target==="string") tVals=[__sbx_norm(target)]; else if(target&&target.length) tVals=target; else return false;');
    lines.push('  var negs=["not","no","never","don\\\'t","dont","won\\\'t","wont","can\\\'t","cant","without"];');
    lines.push('  for(var i=0;i<tVals.length;i++){');
    lines.push('    var hay=String(tVals[i]||"");');
    lines.push('    for(var j=0;j<list.length;j++){');
    lines.push('      var needle=__sbx_norm(list[j]); if(!needle) continue;');
    lines.push('      var idx=-1;');
    lines.push('      while((idx=hay.indexOf(needle,idx+1))!==-1){');
    lines.push('        var pre=hay.substring(0,idx);');
    lines.push('        var isNeg=false;');
    lines.push('        for(var k=0;k<negs.length;k++){');
    lines.push('          var re=new RegExp("(?:^|[\\\\s\\\\W])"+negs[k]+"[\\\\s\\\\W]*$");');
    lines.push('          if(re.test(pre)){ isNeg=true; break; }');
    lines.push('        }');
    lines.push('        if(!isNeg) return true;');
    lines.push('      }');
    lines.push('    }');
    lines.push('  }');
    lines.push('  return false;');
    lines.push('}');
    lines.push('function __sbx_append(path, txt){');
    lines.push('  txt=String(txt==null?"":txt); if(!txt) return;');
    lines.push('  context.character=context.character||{};');
    lines.push('  var cur=String(context.character[path]==null?"":context.character[path]);');
    lines.push('  if(cur && cur.charAt(cur.length-1)!=="\\n") cur+="\\n";');
    lines.push('  context.character[path]=cur+txt;');
    lines.push('}');
    lines.push('function __sbx_appendRandom(path, list){');
    lines.push('  if(!list||!list.length) return;');
    lines.push('  var idx=Math.floor(Math.random()*list.length);');
    lines.push('  __sbx_append(path, list[idx]);');
    lines.push('}');
    lines.push('');

    // Derived
    lines.push('var derived = {};');
    if (appState.derived && appState.derived.length) {
      for (var d = 0; d < appState.derived.length; d++) {
        var der = appState.derived[d] || {};
        if (!der.key || !der.listId) continue;
        var ws = parseInt(der.windowSize, 10);
        if (isNaN(ws) || ws <= 0) ws = 10;
        lines.push('derived[' + JSON.stringify(String(der.key)) + '] = __sbx_countMatches(__sbx_norm_history(__sbx_last_messages(), 50), ' + String(der.listId) + ', ' + ws + ');');
      }
    }
    lines.push('');

    // Blocks
    lines.push('(function(){');
    for (var b = 0; b < appState.blocks.length; b++) {
      var blk = appState.blocks[b] || {};
      var btype = String(blk.type || 'if');
      var join = (String(blk.join || 'AND').toUpperCase() === 'OR') ? 'OR' : 'AND';
      var conds = isArr(blk.conditions) ? blk.conditions : [];
      var acts = isArr(blk.actions) ? blk.actions : [];

      var expr = 'true';
      if (btype !== 'else') {
        if (!conds.length) expr = 'true';
        else {
          var parts = [];
          for (var c = 0; c < conds.length; c++) parts.push(condNodeExpr(conds[c]));
          expr = parts.join(join === 'AND' ? ' && ' : ' || ');
        }
      }

      if (btype === 'if') lines.push('  if (' + expr + ') {');
      else if (btype === 'elseif') lines.push('  else if (' + expr + ') {');
      else lines.push('  else {');

      for (var a = 0; a < acts.length; a++) {
        var st = actionStmt(acts[a]);
        if (st) lines.push('    ' + st);
      }
      lines.push('  }');
    }
    lines.push('})();');

    return lines.join('\n');
  }

  SBX.Codegen.validate = validate;
  SBX.Codegen.generate = generate;

})(window);

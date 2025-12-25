(function (root) {
  'use strict';

  // ============================================================
  // Export Core (IR-first)
  // - Canonical output is a Package IR v1 object (studio.package)
  // - Provides a code preview renderer in correct build order
  // - No CFG export (legacy carry-over removed)
  // ============================================================

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function jsonPretty(obj) {
    try { return JSON.stringify(obj, null, 2); }
    catch (_e) { return JSON.stringify({ error: 'Could not stringify object.' }); }
  }

  function downloadText(filename, text) {
    try {
      var blob = new Blob([String(text)], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (_e) { } }, 250);
    } catch (e) {
      try { window.open('data:text/plain;charset=utf-8,' + encodeURIComponent(String(text))); }
      catch (_e2) { }
    }
  }

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_e) { return fallback; }
  }

  function listPanelDefs() {
    var P = root.Panels || {};
    if (P._list && P._list.length) {
      // P._list contains IDs, we need objects
      var list = [];
      for (var i = 0; i < P._list.length; i++) {
        var item = P._list[i];
        if (typeof item === 'string') {
          if (P[item]) list.push(P[item]);
        } else {
          list.push(item);
        }
      }
      return list;
    }

    var out = [];
    for (var k in P) {
      if (!P.hasOwnProperty(k)) continue;
      if (k === '_list' || k === 'register') continue;
      if (P[k] && typeof P[k] === 'object') out.push(P[k]);
    }
    return out;
  }

  function indexDefsById(defs) {
    var map = {};
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (d && d.id) map[d.id] = d;
    }
    return map;
  }

  function normalizeBuildOrder(order, defById) {
    // Remove unknowns, keep known ids, dedupe, drop 'engine'
    var out = [];
    var seen = {};
    if (!isArr(order)) order = [];

    for (var i = 0; i < order.length; i++) {
      var id = String(order[i] || '');
      if (!id || id === 'engine') continue;
      if (!defById[id]) continue;
      if (seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }

    // Append missing known defs (stable fallback)
    for (var k in defById) {
      if (!defById.hasOwnProperty(k)) continue;
      if (!k || k === 'engine') continue;
      if (seen[k]) continue;
      out.push(k);
      seen[k] = true;
    }

    return out;
  }

  function loadBuildOrder() {
    var defs = listPanelDefs();
    var defById = indexDefsById(defs);

    var raw = lsGet('studio.buildOrder', '');
    if (raw) {
      try { return normalizeBuildOrder(JSON.parse(raw), defById); }
      catch (_e) { }
    }

    // fallback: registry order
    var out = [];
    for (var i = 0; i < defs.length; i++) {
      if (!defs[i] || !defs[i].id) continue;
      if (defs[i].id === 'engine') continue;
      out.push(defs[i].id);
    }
    return normalizeBuildOrder(out, defById);
  }

  function isPanelEnabled(studioState, id) {
    var ps = (studioState && studioState.panels) ? studioState.panels : {};
    var st = ps && ps[id] ? ps[id] : null;
    // default enabled if missing
    return !(st && st.enabled === false);
  }

  // ----------------------------
  // Package builder (delegates to PackageIR if present)
  // ----------------------------
  function buildPackage(studioState, opts) {
    opts = opts || {};
    studioState = studioState || root.StudioState || {};

    var order = opts.buildOrder || loadBuildOrder();
    // console.log('buildPackage order:', order);

    if (root.PackageIR && typeof root.PackageIR.create === 'function') {
      // Preferred: IR module owns structure
      return root.PackageIR.create(studioState, {
        cfg: opts.cfg || null,
        buildOrder: order,
        meta: opts.meta || null
      });
    }

    // Fallback: minimal package, still ordered, still usable
    var defs = listPanelDefs();
    console.log('listPanelDefs count:', defs.length);
    var defById = indexDefsById(defs);
    order = normalizeBuildOrder(order, defById);
    console.log('buildPackage normalized order:', order);

    var blocks = [];
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      var def = defById[id];
      if (!def) continue;

      var enabled = isPanelEnabled(studioState, id);

      if (def.getExportBlocks) {
        try {
          var eb = def.getExportBlocks(studioState) || [];
          if (!isArr(eb)) eb = [];
          for (var j = 0; j < eb.length; j++) {
            var b = eb[j] || {};
            if (String(b.kind) !== 'script') continue;
            blocks.push({
              id: String(b.id || (id + '.script.' + j)),
              panelId: id,
              kind: 'script',
              enabled: enabled,
              title: String(b.id || (id + ' script')),
              data: { language: 'js', runtime: 'es5', code: String(b.code || '') }
            });
          }
          if (blocks.length) continue;
        } catch (_e1) { }
      }

      if (def.getRuleSpecs) {
        var rules = [];
        try {
          rules = def.getRuleSpecs(studioState) || [];
          if (!isArr(rules)) rules = [];
        } catch (_e2) { rules = []; }

        blocks.push({
          id: id + '.rules.v1',
          panelId: id,
          kind: 'dslRules',
          enabled: enabled,
          title: id + ' rules',
          data: { rules: rules, writeTargets: [] }
        });
      }
    }

    return {
      schema: 'studio.package',
      version: 1,
      meta: { title: 'Studio Package', createdAt: (new Date()).toISOString(), tool: 'Studio', toolVersion: '0' },
      buildOrder: order.slice(0),
      cfg: opts.cfg || null,
      panelState: {},
      blocks: blocks
    };
  }

  // ----------------------------
  // Common Runtime (injected once at top)
  // ----------------------------
  var SB_RUNTIME_CODE = [
    '/* === SBX_R: Shared Runtime Helpers ======================================= */',
    'var SBX_R = (function(){',
    '  var R = {};',
    '  R.trim = function(s){ return String(s==null?\"\":s).replace(/^\\s+|\\s+$/g,\"\"); };',
    '  R.esc = function(s){ return String(s).replace(/[\\\\^$.*+?()[\\]{}|]/g, \"\\\\$&\"); };',
    '  R.get = function(o,p){',
    '    var segs = String(p||\"\").split(\".\");',
    '    var cur = o;',
    '    for(var i=0;i<segs.length;i++){ if(!cur)return undefined; cur=cur[segs[i]]; }',
    '    return cur;',
    '  };',
    '  R.set = function(o,p,v){',
    '    var segs = String(p||\"\").split(\".\");',
    '    var cur = o;',
    '    for(var i=0;i<segs.length-1;i++){',
    '      if(!cur[segs[i]] || typeof cur[segs[i]]!==\"object\") cur[segs[i]]={};',
    '      cur=cur[segs[i]];',
    '    }',
    '    cur[segs[segs.length-1]] = v;',
    '  };',
    '  ',
    '  // Safe text append with marker support',
    '  R.append = function(ctx, path, text, marker, once, sep){',
    '    if (!text) return;',
    '    if (!ctx) return;',
    '    var cur = R.get(ctx, path);',
    '    cur = String(cur == null ? "" : cur);',
    '    if (once && marker && cur.indexOf(marker) !== -1) return;',
    '    ',
    '    var chunk = "";',
    '    if (marker) chunk += marker + "\\n";',
    '    chunk += text;',
    '    ',
    '    if (cur.length > 0) {',
    '      // Default to newline if not specified, but check if we need one',
    '      var s = (sep == null) ? "\\n" : sep;',
    '      if (cur.substr(-s.length) !== s) cur += s;',
    '    }',
    '    cur += chunk;',
    '    R.set(ctx, path, cur);',
    '  };',
    '',
    '  // Math',
    '  R.clamp = function(v,min,max){ if(v<min)return min; if(v>max)return max; return v; };',
    '',
    '  // Keyword & Regex',
    '  R.norm = function(s){',
    '    if(s==null) return "";',
    '    s = String(s).toLowerCase();',
    '    s = s.replace(/\\s+/g," ");',
    '    s = s.replace(/^\\s+|\\s+$/g,"");',
    '    return s;',
    '  };',
    '  R.escRegex = function(s){',
    '    return String(s).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
    '  };',
    '  ',
    '  R.parseKeywords = function(raw){',
    '    var s = String(raw||"").replace(/\\r/g,"").replace(/\\n/g,",");',
    '    var parts = s.split(",");',
    '    var out = [];',
    '    var seen = {};',
    '    for(var i=0;i<parts.length;i++){',
    '      var t = R.trim(parts[i]);',
    '      if(!t) continue;',
    '      var k = t.toLowerCase();',
    '      if(!seen[k]){ out.push(t); seen[k]=true; }',
    '    }',
    '    return out;',
    '  };',
    '  R.buildRegex = function(tokens, wholeWord, sensitive){',
    '    if(!tokens || !tokens.length) return null;',
    '    var parts = [];',
    '    for(var i=0;i<tokens.length;i++){',
    '      var t = R.escRegex(tokens[i]).replace(/\\s+/g,"\\\\s+");',
    '      if(wholeWord) t = "\\\\b"+t+"\\\\b";',
    '      parts.push(t);',
    '    }',
    '    var body = "(?:" + parts.join("|") + ")";',
    '    var flags = sensitive ? "" : "i";',
    '    try{ return new RegExp(body, flags); }catch(e){ return null; }',
    '  };',
    '  R.hasAnyPhrase = function(msg, list){',
    '    if(!msg || !list || !list.length) return false;',
    '    for(var i=0;i<list.length;i++) if(msg.indexOf(list[i])!==-1) return true;',
    '    return false;',
    '  };',
    '  R.hasAnyWord = function(msg, list){',
    '    if(!msg || !list || !list.length) return false;',
    '    var padded = \" \" + msg + \" \";',
    '    for(var i=0;i<list.length;i++){',
    '      if(padded.indexOf(\" \" + list[i] + \" \") !== -1) return true;',
    '    }',
    '    return false;',
    '  };',
    '',
    '  // Random utils',
    '  R.roll = function(pct){',
    '    pct = parseFloat(pct);',
    '    if(isNaN(pct) || pct<=0) return false;',
    '    if(pct>=100) return true;',
    '    return (Math.random()*100) < pct;',
    '  };',
    '  R.pick = function(list){',
    '    if(!list || !list.length) return null;',
    '    return list[Math.floor(Math.random()*list.length)];',
    '  };',
    '  R.pickWeighted = function(items){',
    '    // items must have .pct (0-100)',
    '    var total=0; for(var i=0;i<items.length;i++) total += (items[i].pct||0);',
    '    if(total<=0) return null;',
    '    var r = Math.random()*total;',
    '    var acc=0;',
    '    for(i=0;i<items.length;i++){',
    '      acc += (items[i].pct||0);',
    '      if(r<acc) return items[i];',
    '    }',
    '    return items[items.length-1];',
    '  };',
    '  R.msgLower = function(ctx){',
    '    var raw = "";',
    '    if(ctx && ctx.chat && ctx.chat.last_message) raw = String(ctx.chat.last_message);',
    '    return raw.toLowerCase();',
    '  };',
    '  R.getLastMsgs = function(ctx, depth){',
    '    depth = R.clamp(depth||10, 1, 200);',
    '    var arr = null;',
    '    if(ctx && ctx.chat){',
    '      if(ctx.chat.last_messages && ctx.chat.last_messages.length) arr = ctx.chat.last_messages;',
    '      else if(ctx.chat.messages && ctx.chat.messages.length) arr = ctx.chat.messages;',
    '    }',
    '    if(!arr || !arr.length) return "";',
    '    var start = arr.length - depth;',
    '    if(start<0) start = 0;',
    '    var parts = [];',
    '    for(var i=start;i<arr.length;i++) parts.push(String(arr[i]==null?"":arr[i]));',
    '    return parts.join("\\n");',
    '  };',
    '',
    '  return R;',
    '})();',
    ''
  ].join('\n');

  // Polyfill SBX_R for the IDE environment (so generateScript() calls work)
  if (typeof root.SBX_R === 'undefined') {
    try {
      console.log('Attempting to polyfill SBX_R...');
      // Replace 'var SBX_R =' with 'window.SBX_R =' to ensure global assignment
      // Use regex to be safe against spacing
      var polyfill = SB_RUNTIME_CODE.replace(/var\s+SBX_R\s*=/, 'window.SBX_R =');

      // Execute
      (1, eval)(polyfill);

      if (typeof root.SBX_R === 'undefined') {
        console.error('CRITICAL: SBX_R polyfill apparently failed. SBX_R is still undefined.');
      } else {
        console.log('SBX_R polyfill successful.');
      }
    } catch (e) { console.error('Failed to polyfill SBX_R for IDE:', e); }
  }


  // ----------------------------
  // Code preview renderer (ordered)
  // ----------------------------
  function renderPackageCode(pkg, opts) {
    // console.log('renderPackageCode called', pkg);
    if (typeof SBX_R === 'undefined') {
      console.error('CRITICAL: SBX_R is not defined in renderPackageCode scope!');
    }
    opts = opts || {};
    if (!pkg || !pkg.blocks || !isArr(pkg.blocks)) return '';

    var includeDisabled = !!opts.includeDisabled;
    var includeDslAsJson = (opts.includeDslAsJson !== false); // default true

    var out = [];
    out.push('// ============================================================');
    out.push('// Studio Export Preview (ordered)');
    out.push('// schema=' + String(pkg.schema || '') + ' version=' + String(pkg.version || ''));
    out.push('// ============================================================');
    out.push('');

    // Inject Runtime if we have any scripts
    var hasScript = false;
    for (var k = 0; k < pkg.blocks.length; k++) {
      if (pkg.blocks[k].kind === 'script') { hasScript = true; break; }
    }
    // console.log('renderPackageCode hasScript:', hasScript);
    if (hasScript) {
      out.push(SB_RUNTIME_CODE);
      out.push('');
    }

    for (var i = 0; i < pkg.blocks.length; i++) {
      var b = pkg.blocks[i];
      if (!b) continue;

      // console.log('Processing block:', b.id, 'enabled:', b.enabled, 'includeDisabled:', includeDisabled);

      if (!includeDisabled && b.enabled === false) {
        console.warn('Skipping disabled block:', b.id);
        continue;
      }

      var hdr = '/* --- ' + String(b.panelId || '') + ' :: ' + String(b.kind || '') + ' :: ' + String(b.id || '') + ' --- */';
      out.push(hdr);

      if (b.kind === 'script') {
        var code = b.data && b.data.code ? String(b.data.code) : '';
        out.push(code);
      } else if (b.kind === 'dslRules') {
        // Until the runtime exporter is finished, we keep this import-safe.
        // Advanced/Sitebuilder X can ingest the IR; Engine can still show it.
        if (includeDslAsJson) {
          out.push('/* DSL Rules (IR payload) */');
          out.push('var __' + safeIdent(String(b.panelId || 'module')) + '_rules = ' + jsonPretty((b.data && b.data.rules) ? b.data.rules : []) + ';');
        } else {
          out.push('/* DSL Rules omitted from preview */');
        }
      } else if (b.kind === 'sbxConfig') {
        out.push('/* Sitebuilder X config block (import-only) */');
      } else {
        out.push('/* Unknown block kind: ' + String(b.kind) + ' */');
      }

      out.push(''); // spacing
    }

    return out.join('\n');
  }

  function safeIdent(s) {
    s = String(s || 'x');
    s = s.replace(/[^a-zA-Z0-9_]/g, '_');
    if (!s) s = 'x';
    if (s.charAt(0) >= '0' && s.charAt(0) <= '9') s = '_' + s;
    return s;
  }

  // ----------------------------
  // Public API (Engine + future Advanced will use this)
  // ----------------------------
  var DataShaper = {};

  // Canonical
  DataShaper.buildPackage = function (studioState, opts) {
    return buildPackage(studioState || (root.StudioState || {}), opts || {});
  };

  DataShaper.renderPackageCode = function (pkg, opts) {
    return renderPackageCode(pkg, opts || {});
  };

  // Convenience: build+render
  DataShaper.buildCodePreview = function (studioState, opts) {
    var pkg = buildPackage(studioState || (root.StudioState || {}), opts || {});
    return renderPackageCode(pkg, opts || {});
  };

  // Downloads
  DataShaper.downloadPackage = function (studioState, opts) {
    var pkg = buildPackage(studioState || (root.StudioState || {}), opts || {});
    downloadText((opts && opts.filename) ? opts.filename : 'mythos.package.json', jsonPretty(pkg));
    return pkg;
  };

  // expose
  root.DataShaper = DataShaper;

})(window);

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
      setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(_e){} }, 250);
    } catch (e) {
      try { window.open('data:text/plain;charset=utf-8,' + encodeURIComponent(String(text))); }
      catch (_e2) {}
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
    if (P._list && P._list.length) return P._list.slice(0);

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
      catch (_e) {}
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
    var defById = indexDefsById(defs);
    order = normalizeBuildOrder(order, defById);

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
        } catch (_e1) {}
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
  // Code preview renderer (ordered)
  // ----------------------------
  function renderPackageCode(pkg, opts) {
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

    for (var i = 0; i < pkg.blocks.length; i++) {
      var b = pkg.blocks[i];
      if (!b) continue;
      if (!includeDisabled && b.enabled === false) continue;

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

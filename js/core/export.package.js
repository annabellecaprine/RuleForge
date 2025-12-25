(function (root) {
  'use strict';

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function nowISO() { try { return (new Date()).toISOString(); } catch (_e) { return ''; } }

  function safeClone(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch (_e) { return null; }
  }

  function listPanelDefs() {
    var P = root.Panels || {};
    if (P._list && P._list.length) {
      // Registry stores IDs in _list, but we need the actual objects
      var out = [];
      for (var i = 0; i < P._list.length; i++) {
        var item = P._list[i];
        if (typeof item === 'string') {
          if (P[item]) out.push(P[item]);
        } else {
          // Legacy support if it somehow stored objects
          out.push(item);
        }
      }
      return out;
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

  function getPanelsEnabledMap(studioState) {
    var ps = (studioState && studioState.panels) ? studioState.panels : {};
    return ps || {};
  }

  function isPanelEnabled(studioState, panelId) {
    var ps = getPanelsEnabledMap(studioState);
    var st = ps && ps[panelId] ? ps[panelId] : null;
    return !(st && st.enabled === false);
  }

  function normalizeBuildOrder(buildOrder, defById) {
    // Keep only known panels; preserve order; drop 'engine'
    var out = [];
    var seen = {};
    var i, id;

    if (!isArr(buildOrder)) buildOrder = [];

    for (i = 0; i < buildOrder.length; i++) {
      id = String(buildOrder[i] || '');
      if (!id || id === 'engine') continue;
      if (!defById[id]) {
        continue;
      }
      if (seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }

    // Append any defs not in order (stable fallback)
    for (id in defById) {
      if (!defById.hasOwnProperty(id)) continue;
      // console.error('Checking fallback id:', id); 
      if (!id || id === 'engine') continue;
      if (seen[id]) continue;
      out.push(id);
      seen[id] = true;
    }

    console.error('normalizeBuildOrder final out:', out.length);

    return out;
  }

  function panelToBlocks(studioState, panelId, def) {
    var enabled = isPanelEnabled(studioState, panelId);
    var blocks = [];

    // Prefer explicit export blocks (script chunks)
    if (def && typeof def.getExportBlocks === 'function') {
      try {
        console.log('PackageIR: Getting blocks for', panelId);
        var eb = def.getExportBlocks(studioState) || [];
        console.log('PackageIR: Got blocks for', panelId, ':', eb);
        if (!isArr(eb)) eb = [];

        for (var i = 0; i < eb.length; i++) {
          var b = eb[i] || {};
          if (String(b.kind) !== 'script') continue;

          blocks.push({
            id: String(b.id || (panelId + '.script.' + i)),
            panelId: panelId,
            kind: 'script',
            enabled: enabled,
            title: String(b.id || (panelId + ' script')),
            data: {
              language: 'js',
              runtime: 'es5',
              code: String(b.code || '')
            }
          });
        }

        // If it provided any scripts, we treat that as authoritative for this panel
        // But we ALSO want to fall through to provide dslRules so SiteBuilder X can import them.
        // if (blocks.length) return blocks; 

      } catch (_e1) {
        console.error('PackageIR: Error getting export blocks for ' + panelId, _e1);
        // fall through to dsl rules
      }
    }

    // Otherwise: DSL rules
    if (def && typeof def.getRuleSpecs === 'function') {
      var rules = [];
      try {
        rules = def.getRuleSpecs(studioState) || [];
        if (!isArr(rules)) rules = [];
      } catch (_e2) {
        rules = [];
      }

      // Ensure moduleId is present (useful for debugging/import)
      for (var r = 0; r < rules.length; r++) {
        if (rules[r] && !rules[r].moduleId) rules[r].moduleId = panelId;
      }

      var wt = [];
      try {
        if (typeof def.getWriteTargets === 'function') wt = def.getWriteTargets(studioState) || [];
        if (!isArr(wt)) wt = [];
      } catch (_e3) {
        wt = [];
      }

      blocks.push({
        id: panelId + '.rules.v1',
        panelId: panelId,
        kind: 'dslRules',
        enabled: enabled,
        title: panelId + ' rules',
        data: {
          rules: rules,
          writeTargets: wt
        }
      });
    }

    return blocks;
  }

  function create(studioState, opts) {
    opts = opts || {};
    studioState = studioState || root.StudioState || {};

    var defs = listPanelDefs();
    var defById = indexDefsById(defs);

    var rawOrder = opts.buildOrder || studioState.buildOrder;
    // Fallback: if no order is defined, use registry order (excluding engine)
    if (!rawOrder || !isArr(rawOrder) || rawOrder.length === 0) {
      rawOrder = [];
      for (var k = 0; k < defs.length; k++) {
        if (defs[k] && defs[k].id && defs[k].id !== 'engine') {
          rawOrder.push(defs[k].id);
        }
      }
    }

    var order = normalizeBuildOrder(rawOrder, defById);

    var blocks = [];
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      var def = defById[id];
      if (!def) continue;

      var bs = panelToBlocks(studioState, id, def);
      for (var j = 0; j < bs.length; j++) blocks.push(bs[j]);
    }

    var pkg = {
      schema: 'studio.package',
      version: 1,
      meta: {
        title: String((opts.meta && opts.meta.title) ? opts.meta.title : 'Studio Package'),
        createdAt: nowISO(),
        tool: 'Studio',
        toolVersion: String(studioState && studioState.version ? studioState.version : '0')
      },
      buildOrder: order.slice(0),
      cfg: opts.cfg || null,
      panelState: safeClone(studioState.data || {}) || {},
      blocks: blocks
    };

    return pkg;
  }

  function validate(pkg) {
    var errs = [];
    if (!pkg || typeof pkg !== 'object') return ['Package is not an object.'];
    if (pkg.schema !== 'studio.package') errs.push('schema must be "studio.package".');
    if (pkg.version !== 1) errs.push('version must be 1.');
    if (!isArr(pkg.buildOrder)) errs.push('buildOrder must be an array.');
    if (!isArr(pkg.blocks)) errs.push('blocks must be an array.');

    if (isArr(pkg.blocks)) {
      for (var i = 0; i < pkg.blocks.length; i++) {
        var b = pkg.blocks[i];
        if (!b || typeof b !== 'object') { errs.push('block[' + i + '] is not an object.'); continue; }
        if (!b.id) errs.push('block[' + i + '] missing id.');
        if (!b.panelId) errs.push('block[' + i + '] missing panelId.');
        if (b.kind !== 'dslRules' && b.kind !== 'script' && b.kind !== 'sbxConfig') {
          errs.push('block[' + i + '] kind invalid: ' + b.kind);
        }
        if (!b.data || typeof b.data !== 'object') errs.push('block[' + i + '] missing data.');
      }
    }
    return errs;
  }

  // Expose
  root.PackageIR = {
    create: create,
    validate: validate
  };

})(window);

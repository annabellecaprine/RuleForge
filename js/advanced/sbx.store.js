(function (root) {
  'use strict';
  if (!root || !root.SBX || !root.SBX.util) { throw new Error('sbx.store.js requires sbx.ns.js and sbx.util.js loaded first'); }

  var U = root.SBX.util;
  var S = root.SBX.store = root.SBX.store || {};

  // Storage adapters
  function _getLS() { try { return root.localStorage; } catch (e) { return null; } }

  function _readLS(key) {
    var ls = _getLS();
    if (!ls) return null;
    try { return ls.getItem(key); } catch (e) { return null; }
  }

  function _writeLS(key, val) {
    var ls = _getLS();
    if (!ls) return;
    try { ls.setItem(key, val); } catch (e) {}
  }

  function _parseJSON(s) {
    if (!s || typeof s !== 'string') return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function _stringifyJSON(o) {
    try { return JSON.stringify(o); } catch (e) { return null; }
  }

  // Defaults: v2 store schema
  S.DEFAULTS = function () {
    return {
      version: 2,

      // Global Advanced lists shared across modules
      lists: [],

      // Shared UI state
      ui: {
        viewMode: 'editor', // 'editor' | 'test'
        debugOpen: false,
        importedOpen: true,
        selectedImportedKey: null,

        // advanced shell
        advActiveTab: 'engine',         // 'engine' | 'test' | 'module:<id>'
        advActiveModuleId: 'global'     // module editor currently shown
      },

      // Imported packages (from core/runtime/export) or older SBX
      imported: {
        pkg: null,
        blocks: []
      },

      // Legacy v1 fallback container
      appState: {
        lists: [],
        derived: [],
        blocks: []
      },

      // Module-specific data (advanced module tabs)
      modules: {
        global: {
          id: 'global',
          label: 'Global',
          description: '',
          ui: {},
          appState: { lists: [], derived: [], blocks: [] }
        }
      },

      // Order of modules for build / compile (advanced engine ordering)
      moduleOrder: ['global']
    };
  };

  // Ensure the main StudioState storage exists
  S.ensureStudioState = function (rootObj, dataKey) {
    rootObj = rootObj || root;
    dataKey = dataKey || 'sitebuilderx';
    rootObj.StudioState = rootObj.StudioState || {};
    rootObj.StudioState.data = rootObj.StudioState.data || {};
    if (!rootObj.StudioState.data[dataKey]) {
      rootObj.StudioState.data[dataKey] = S.DEFAULTS();
    }
    return rootObj.StudioState;
  };

  function _hasAny(arr) { return U.isArr(arr) && arr.length > 0; }

  function _mergeListsById(target, src) {
    if (!U.isArr(target)) target = [];
    if (!U.isArr(src) || !src.length) return target;

    var seen = {};
    var i, id;

    for (i = 0; i < target.length; i++) {
      id = target[i] && target[i].id;
      if (id != null && id !== '') seen[String(id)] = 1;
    }

    for (i = 0; i < src.length; i++) {
      var L = src[i];
      if (!L) continue;
      id = (L.id == null) ? '' : String(L.id);
      if (!id) continue;
      if (seen[id]) continue;
      seen[id] = 1;
      target.push(L);
    }
    return target;
  }

  function _collectPerModuleLists(modulesObj) {
    var merged = [];
    if (!modulesObj || typeof modulesObj !== 'object') return merged;

    for (var mid in modulesObj) {
      if (!modulesObj.hasOwnProperty(mid)) continue;
      var mod = modulesObj[mid];
      var al = mod && mod.appState && mod.appState.lists;
      if (!_hasAny(al)) continue;
      merged = _mergeListsById(merged, al);
    }
    return merged;
  }

  // Migration: accepts unknown/older shapes and returns a safe v2 object.
  // IMPORTANT: We ALWAYS merge any legacy per-module lists into the global d.lists bucket.
  S.migrate = function (data) {
    var d = (data && typeof data === 'object') ? data : S.DEFAULTS();
    if (!d || typeof d !== 'object') d = S.DEFAULTS();

    // Ensure containers
    d.ui = d.ui || {};
    d.lists = U.isArr(d.lists) ? d.lists : [];
    d.imported = d.imported || { pkg: null, blocks: [] };
    d.appState = d.appState || { lists: [], derived: [], blocks: [] };

    // v2 containers
    if (!d.modules || typeof d.modules !== 'object') d.modules = {};
    if (!d.moduleOrder || !U.isArr(d.moduleOrder)) d.moduleOrder = [];

    // Ensure global module
    if (!d.modules.global) {
      d.modules.global = {
        id: 'global',
        label: 'Global',
        description: '',
        ui: {},
        appState: { lists: [], derived: [], blocks: [] }
      };
    }
    var g = d.modules.global;
    g.ui = g.ui || {};
    g.appState = g.appState || { lists: [], derived: [], blocks: [] };
    g.appState.lists = U.isArr(g.appState.lists) ? g.appState.lists : [];

    // ---- Global list migration & merge (aggressive) ----
    // Merge legacy v1: d.appState.lists
    if (d.appState && _hasAny(d.appState.lists)) {
      d.lists = _mergeListsById(d.lists, d.appState.lists);
    }

    // Merge legacy v2: d.modules.global.appState.lists
    if (g && g.appState && _hasAny(g.appState.lists)) {
      d.lists = _mergeListsById(d.lists, g.appState.lists);
    }

    // Merge any per-module lists into global
    var per = _collectPerModuleLists(d.modules);
    if (_hasAny(per)) {
      d.lists = _mergeListsById(d.lists, per);
    }

    // Normalize UI keys
    if (!d.ui.viewMode) d.ui.viewMode = 'editor';
    if (typeof d.ui.debugOpen !== 'boolean') d.ui.debugOpen = false;
    if (typeof d.ui.importedOpen !== 'boolean') d.ui.importedOpen = true;
    if (!('selectedImportedKey' in d.ui)) d.ui.selectedImportedKey = null;

    // advanced shell UI
    if (!d.ui.advActiveTab) d.ui.advActiveTab = 'engine';
    if (!d.ui.advActiveModuleId) d.ui.advActiveModuleId = 'global';

    // Ensure moduleOrder contains global and only valid ids
    if (d.moduleOrder.length === 0) d.moduleOrder = ['global'];
    var seenM = {};
    var cleaned = [];
    for (var ii = 0; ii < d.moduleOrder.length; ii++) {
      var id2 = String(d.moduleOrder[ii] || '');
      if (!id2) continue;
      if (seenM[id2]) continue;
      seenM[id2] = 1;
      cleaned.push(id2);
    }
    if (!seenM.global) cleaned.unshift('global');
    d.moduleOrder = cleaned;

    // Ensure each referenced module exists
    for (var jj = 0; jj < d.moduleOrder.length; jj++) {
      var mid2 = d.moduleOrder[jj];
      if (!d.modules[mid2]) {
        d.modules[mid2] = {
          id: mid2,
          label: mid2,
          description: '',
          ui: {},
          appState: { lists: [], derived: [], blocks: [] }
        };
      }
      var mm = d.modules[mid2];
      mm.ui = mm.ui || {};
      mm.appState = mm.appState || { lists: [], derived: [], blocks: [] };
      mm.appState.lists = U.isArr(mm.appState.lists) ? mm.appState.lists : [];
      if (!mm.id) mm.id = mid2;
      if (!mm.label) mm.label = mid2;
    }

    d.version = 2;
    return d;
  };

  // Load from StudioState or localStorage
  S.load = function (rootObj, opts) {
    rootObj = rootObj || root;
    opts = opts || {};
    var dataKey = opts.dataKey || 'sitebuilderx';
    var storeKey = opts.storeKey || ('studio.' + dataKey);

    // Prefer StudioState if available
    var ss = rootObj.StudioState;
    if (ss && ss.data && ss.data[dataKey]) {
      ss.data[dataKey] = S.migrate(ss.data[dataKey]);
      return ss.data[dataKey];
    }

    // Fallback to localStorage
    var raw = _readLS(storeKey);
    var parsed = _parseJSON(raw);
    var migrated = S.migrate(parsed || S.DEFAULTS());

    // Ensure StudioState is filled too (so UI uses one source of truth)
    rootObj.StudioState = rootObj.StudioState || {};
    rootObj.StudioState.data = rootObj.StudioState.data || {};
    rootObj.StudioState.data[dataKey] = migrated;

    return migrated;
  };

  // Save into StudioState and localStorage
  S.save = function (rootObj, data, opts) {
    rootObj = rootObj || root;
    opts = opts || {};
    var dataKey = opts.dataKey || 'sitebuilderx';
    var storeKey = opts.storeKey || ('studio.' + dataKey);

    data = S.migrate(data);

    // StudioState
    rootObj.StudioState = rootObj.StudioState || {};
    rootObj.StudioState.data = rootObj.StudioState.data || {};
    rootObj.StudioState.data[dataKey] = data;

    // localStorage
    var raw = _stringifyJSON(data);
    if (raw) _writeLS(storeKey, raw);

    return data;
  };

  // Ensure a module exists in the store
  S.ensureModule = function (data, moduleId, meta) {
    moduleId = String(moduleId || '');
    if (!moduleId) moduleId = 'global';
    data = S.migrate(data);

    if (!data.modules[moduleId]) {
      data.modules[moduleId] = {
        id: moduleId,
        label: (meta && meta.label) ? String(meta.label) : moduleId,
        description: (meta && meta.description) ? String(meta.description) : '',
        ui: {},
        appState: { lists: [], derived: [], blocks: [] }
      };
    }

    // Ensure order list contains module
    var found = false;
    for (var i = 0; i < data.moduleOrder.length; i++) if (data.moduleOrder[i] === moduleId) found = true;
    if (!found) data.moduleOrder.push(moduleId);

    return data;
  };

})(window);

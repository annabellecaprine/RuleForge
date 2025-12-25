/* ============================================================================
 *  sources.js — Shared Source Registry (Studio Compiler Input Layer)
 *  ----------------------------------------------------------------------------
 *  Purpose
 *    Provide a single canonical way to read "inputs" (aka Sources) from:
 *      - ctx  (runtime context / JanitorAI context object)
 *      - state (persistent studio state, if you keep one)
 *      - derived (computed metrics for this evaluation pass)
 *
 *    Modules NEVER reach into ctx directly. They request values by sourceId.
 *
 *  ES5 only. No dependencies.
 * ============================================================================ */
(function (root) {
  'use strict';

  // --------------------------------------------------------------------------
  // Internal storage
  // --------------------------------------------------------------------------
  var Sources = {};
  var _registry = {};  // sourceId -> SourceSpec
  var _modules = {};   // moduleId -> { allow: {sourceId:true} }

  // --------------------------------------------------------------------------
  // Utilities (ES5-safe)
  // --------------------------------------------------------------------------
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function pushTrace(trace, evt) {
    if (!trace) return;
    try { trace.push(evt); } catch (_e) {}
  }

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  // Resolve dotted path against ctx/state/derived safely.
  // Example: "context.chat.last_message"
  function getPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      var key = parts[i];
      if (!cur || typeof cur !== 'object') return undefined;
      if (!hasOwn(cur, key)) return undefined;
      cur = cur[key];
    }
    return cur;
  }

  // --------------------------------------------------------------------------
  // Normalizer Registry
  // --------------------------------------------------------------------------
  var Normalizers = {
    identity: function (v) { return v; }
  };

  function applyNormalizer(name, value) {
    if (!name) return value;
    var fn = Normalizers[name];
    if (typeof fn === 'function') return fn(value);
    return value;
  }

  // --------------------------------------------------------------------------
  // SourceSpec Contract
  // --------------------------------------------------------------------------
  // Stored spec is always:
  //   { id, getter(ctx,state,derived), label?, kind?, normalizer?, meta?, pathHint? }
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Registry API
  // --------------------------------------------------------------------------
  Sources.register = function (spec) {
    if (!spec || !spec.id) throw new Error('Sources.register: spec.id required');
    if (typeof spec.getter !== 'function') throw new Error('Sources.register: spec.getter required');
    _registry[spec.id] = spec;
    return spec.id;
  };

  Sources.registerMany = function (specs) {
    if (!specs || !specs.length) return 0;
    var n = 0;
    for (var i = 0; i < specs.length; i++) {
      if (!specs[i]) continue;
      Sources.register(specs[i]);
      n++;
    }
    return n;
  };

  Sources.unregister = function (sourceId) {
    if (sourceId && hasOwn(_registry, sourceId)) delete _registry[sourceId];
  };

  Sources.getSpec = function (sourceId) {
    return (sourceId && hasOwn(_registry, sourceId)) ? _registry[sourceId] : null;
  };

  Sources.list = function () {
    var out = [], k;
    for (k in _registry) if (hasOwn(_registry, k)) out.push(k);
    out.sort();
    return out;
  };

  // --------------------------------------------------------------------------
  // Module allowlists (Basic mode restriction layer)
  // --------------------------------------------------------------------------
  Sources.setModuleAllowlist = function (moduleId, sourceIds) {
    if (!moduleId) throw new Error('Sources.setModuleAllowlist: moduleId required');

    var allow = {}, i;
    sourceIds = sourceIds || [];
    for (i = 0; i < sourceIds.length; i++) {
      allow[sourceIds[i]] = true;
    }

    _modules[moduleId] = _modules[moduleId] || {};
    _modules[moduleId].allow = allow;
  };

  Sources.isAllowed = function (moduleId, sourceId) {
    var m = _modules[moduleId];
    if (!m || !m.allow) return true; // Advanced default
    return !!m.allow[sourceId];
  };

  // --------------------------------------------------------------------------
  // Sources.read()
  // --------------------------------------------------------------------------
  Sources.read = function (moduleId, sourceId, ctx, state, derived, options) {
    options = options || {};
    var strict = !!options.strict;
    var trace = options.trace || null;

    var spec = Sources.getSpec(sourceId);
    if (!spec) {
      pushTrace(trace, { kind: 'sourceMissing', moduleId: moduleId, sourceId: sourceId, ok: false });
      if (strict) throw new Error('Sources.read: unknown sourceId "' + sourceId + '"');
      return undefined;
    }

    if (!Sources.isAllowed(moduleId, sourceId)) {
      pushTrace(trace, { kind: 'sourceNotAllowed', moduleId: moduleId, sourceId: sourceId, ok: false });
      if (strict) throw new Error('Sources.read: source not allowed "' + sourceId + '" for module "' + moduleId + '"');
      return undefined;
    }

    try {
      var val = spec.getter(ctx, state, derived);
      val = applyNormalizer(spec.normalizer, val);

      pushTrace(trace, { kind: 'sourceRead', moduleId: moduleId, sourceId: sourceId, ok: true });
      return val;
    } catch (e) {
      pushTrace(trace, {
        kind: 'sourceError',
        moduleId: moduleId,
        sourceId: sourceId,
        ok: false,
        error: String(e && e.message ? e.message : e)
      });
      if (strict) throw e;
      return undefined;
    }
  };

  // --------------------------------------------------------------------------
  // Normalizer extension API
  // --------------------------------------------------------------------------
  Sources.registerNormalizer = function (name, fn) {
    if (!name || typeof fn !== 'function') throw new Error('Sources.registerNormalizer: invalid');
    Normalizers[name] = fn;
  };

  // --------------------------------------------------------------------------
  // Path-based defaults compatibility
  // --------------------------------------------------------------------------
  // Your sources.defaults.js provides: { id, path, meta }
  // This helper converts it to a real SourceSpec with a getter.
  Sources.registerPathSpec = function (pathSpec) {
    if (!pathSpec || !pathSpec.id) throw new Error('Sources.registerPathSpec: id required');
    if (!pathSpec.path) throw new Error('Sources.registerPathSpec: path required');

    var id = String(pathSpec.id);
    var path = String(pathSpec.path);
    var meta = pathSpec.meta || {};

    // Getter reads from ctx only (because paths are dev contract context paths)
    var getter = function (ctx, _state, _derived) {
      // Most paths begin with "context." — the ctx we receive is expected to be the full runtime object.
      return getPath(ctx, path);
    };

    // Store meta + human label/kind hints if provided
    var spec = {
      id: id,
      getter: getter,
      pathHint: path,
      label: meta.label || '',
      kind: meta.kind || '',
      meta: meta
    };

    return Sources.register(spec);
  };

  Sources.registerManyPathSpecs = function (defs) {
    if (!defs || !defs.length) return 0;
    var n = 0;
    for (var i = 0; i < defs.length; i++) {
      if (!defs[i]) continue;
      Sources.registerPathSpec(defs[i]);
      n++;
    }
    return n;
  };

  // --------------------------------------------------------------------------
  // defineDefaults()
  // --------------------------------------------------------------------------
  // Supports both:
  //   A) defineDefaults([pathSpecs...])  // from sources.defaults.js
  //   B) defineDefaults(function(Sources){ ... }) // older style
  Sources.defineDefaults = function (arg) {
    // A) array of pathSpecs or SourceSpecs
    if (isArr(arg)) {
      // If entries have getter -> treat as SourceSpecs; else treat as pathSpecs.
      if (arg.length && arg[0] && typeof arg[0].getter === 'function') {
        return Sources.registerMany(arg);
      }
      return Sources.registerManyPathSpecs(arg);
    }

    // B) callback style
    if (typeof arg === 'function') {
      return arg(Sources);
    }

    // Otherwise ignore silently (fail-soft)
    return 0;
  };

  // --------------------------------------------------------------------------
  // debugDump()
  // --------------------------------------------------------------------------
  Sources.debugDump = function () {
    var out = {}, k;
    for (k in _registry) if (hasOwn(_registry, k)) {
      var s = _registry[k];
      out[k] = {
        id: s.id,
        label: s.label || '',
        kind: s.kind || 'unknown',
        normalizer: s.normalizer || '',
        pathHint: s.pathHint || '',
        meta: s.meta || null
      };
    }
    return out;
  };

  // --------------------------------------------------------------------------
  // Export
  // --------------------------------------------------------------------------
  root.Sources = Sources;

})(window);

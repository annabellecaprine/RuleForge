/* ============================================================================
 * init.js — App Initialization (Basic mode + Sources sanity check)
 * ----------------------------------------------------------------------------
 * Standalone tool. Generates ES5 script for JAI; locally uses simulation.
 * Responsibilities:
 *   - Set initial app mode
 *   - Apply Basic module allowlists
 *   - Register convenience sourceIds used by Basic modules (raw/norm/history)
 *   - Sanity-check registry + allowlists + getter callability using a stub ctx
 * ============================================================================ */
(function (root) {
  'use strict';

  if (!root.Sources) {
    throw new Error('init.js: window.Sources missing. Check script load order.');
  }

  var Sources = root.Sources;

  // --------------------------------------------------------------------------
  // App Mode
  // --------------------------------------------------------------------------
  var MODE = 'basic';

  // --------------------------------------------------------------------------
  // Basic allowlists (single source of truth)
  // --------------------------------------------------------------------------
  var ID_SOURCES = ['character.chatName', 'user.personaName'];

  var BASIC_ALLOWLISTS = {
    lorebook: [
      'lastUser.norm',
      'history.norm',
      'historyText.norm',
      'scenario.norm',
      'personality.norm'
    ],

    memory: [
      'lastUser.raw',
      'lastUser.norm',
      'history.norm',
      'scenario.norm',
      'personality.norm'
    ],

    events: [
      'chat.messageCount',
      'lastUser.norm',
      'history.norm',
      'scenario.norm',
      'personality.norm'
    ],

    tone: [
      'lastUser.norm',
      'history.norm',
      'scenario.norm',
      'personality.norm'
    ],

    ambient: [
      'lastUser.norm',
      'history.norm',
      'scenario.norm',
      'personality.norm'
    ],

    randomEvents: [
      'lastUser.norm',
      'history.norm',
      'scenario.norm',
      'personality.norm',
      'chat.messageCount'
    ],

    conditionCombiner: [
      'lastUser.norm',
      'history.norm',
      'scenario.norm',
      'personality.norm'
    ],

    scoring: [
      'lastUser.norm',
      'history.norm',
      'historyText.norm',
      'scenario.norm',
      'personality.norm',
      'chat.messageCount'
    ]
  };

  function concat(a, b) {
    var out = a.slice(0), i;
    for (i = 0; i < b.length; i++) out.push(b[i]);
    return out;
  }

  function applyBasicAllowlists() {
    var mod;
    for (mod in BASIC_ALLOWLISTS) {
      if (!Object.prototype.hasOwnProperty.call(BASIC_ALLOWLISTS, mod)) continue;
      Sources.setModuleAllowlist(mod, concat(BASIC_ALLOWLISTS[mod], ID_SOURCES));
    }
  }

  // --------------------------------------------------------------------------
  // Context helpers (support BOTH shapes)
  // --------------------------------------------------------------------------
  // Dev shape:   ctx.context.character / ctx.context.chat
  // Legacy shape: ctx.character / ctx.chat
  function ctxCharacter(ctx) {
    if (ctx && ctx.context && ctx.context.character) return ctx.context.character;
    if (ctx && ctx.character) return ctx.character;
    return null;
  }
  function ctxChat(ctx) {
    if (ctx && ctx.context && ctx.context.chat) return ctx.context.chat;
    if (ctx && ctx.chat) return ctx.chat;
    return null;
  }

  function safeStr(x) { return x == null ? '' : String(x); }

  // Join last_messages into a single text blob
  function joinHistoryText(ctx) {
    var chat = ctxChat(ctx);
    var arr = chat ? chat.last_messages : null;
    if (!arr || !arr.length) return '';

    var out = '';
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (!it) continue;

      // Support both: {message:"..."} and raw string entries
      var msg = (typeof it === 'string') ? it : safeStr(it.message);
      if (!msg) continue;

      if (out) out += '\n';
      out += msg;
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Stub context builder (simulation-friendly)
  // --------------------------------------------------------------------------
  function buildStubCtx() {
    return {
      context: {
        character: {
          name: 'Bot',
          chat_name: 'Bot',
          personality: '',
          scenario: '',
          example_dialogs: ''
        },
        chat: {
          message_count: 0,
          user_name: null,
          persona_name: 'User',
          last_message: '',
          last_messages: [] // array of { message: "..." }
        }
      }
    };
  }

  // --------------------------------------------------------------------------
  // Convenience sources (raw/norm/history + aliases)
  // --------------------------------------------------------------------------
  function registerConvenienceSources() {
    if (!Sources || typeof Sources.register !== 'function') return;

    // Normalizer used by *.norm (if not already present)
    if (typeof Sources.registerNormalizer === 'function') {
      try {
        Sources.registerNormalizer('normalizeText', function (v) {
          if (v == null) return '';
          v = String(v);
          v = v.toLowerCase();
          v = v.replace(/\s+/g, ' ');
          v = v.replace(/^\s+|\s+$/g, '');
          return v;
        });
      } catch (_e0) {}
    }

    function reg(spec) {
      try {
        if (Sources.getSpec && Sources.getSpec(spec.id)) return;
        Sources.register(spec);
      } catch (_e1) {}
    }

    // scenario.*
    reg({
      id: 'scenario.raw',
      getter: function (ctx) {
        var c = ctxCharacter(ctx);
        return c ? safeStr(c.scenario) : '';
      }
    });
    reg({
      id: 'scenario.norm',
      getter: function (ctx) {
        var c = ctxCharacter(ctx);
        return c ? safeStr(c.scenario) : '';
      },
      normalizer: 'normalizeText'
    });

    // personality.*
    reg({
      id: 'personality.raw',
      getter: function (ctx) {
        var c = ctxCharacter(ctx);
        return c ? safeStr(c.personality) : '';
      }
    });
    reg({
      id: 'personality.norm',
      getter: function (ctx) {
        var c = ctxCharacter(ctx);
        return c ? safeStr(c.personality) : '';
      },
      normalizer: 'normalizeText'
    });

    // lastUser.*
    reg({
      id: 'lastUser.raw',
      getter: function (ctx) {
        var ch = ctxChat(ctx);
        return ch ? safeStr(ch.last_message) : '';
      }
    });
    reg({
      id: 'lastUser.norm',
      getter: function (ctx) {
        var ch = ctxChat(ctx);
        return ch ? safeStr(ch.last_message) : '';
      },
      normalizer: 'normalizeText'
    });

    // lastBot.* (unknown in Basic stub; keep empty)
    reg({ id: 'lastBot.raw', getter: function (_ctx) { return ''; } });
    reg({ id: 'lastBot.norm', getter: function (_ctx) { return ''; }, normalizer: 'normalizeText' });

    // history.* (array + text)
    reg({
      id: 'history.raw',
      getter: function (ctx) {
        var ch = ctxChat(ctx);
        var arr = ch ? ch.last_messages : null;
        return arr || [];
      }
    });
    reg({
      id: 'history.norm',
      getter: function (ctx) {
        return joinHistoryText(ctx);
      },
      normalizer: 'normalizeText'
    });

    reg({
      id: 'historyText.raw',
      getter: function (ctx) {
        return joinHistoryText(ctx);
      }
    });
    reg({
      id: 'historyText.norm',
      getter: function (ctx) {
        return joinHistoryText(ctx);
      },
      normalizer: 'normalizeText'
    });

    // Aliases expected by allowlists/sanity
    reg({
      id: 'chat.messageCount',
      getter: function (ctx) {
        var ch = ctxChat(ctx);
        var v = ch ? ch.message_count : 0;
        return (typeof v === 'number') ? v : 0;
      }
    });

    reg({
      id: 'user.personaName',
      getter: function (ctx) {
        var ch = ctxChat(ctx);
        var v = ch ? ch.persona_name : null;
        return v == null ? '' : String(v);
      }
    });

    reg({
      id: 'character.chatName',
      getter: function (ctx) {
        var c = ctxCharacter(ctx);
        var v = c ? c.chat_name : '';
        return safeStr(v);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Sources Sanity Check
  // --------------------------------------------------------------------------
  function runSourcesSanityCheck() {
    var warnings = 0;

    function logInfo(msg) {
      if (root.console && console.info) console.info('[Sources Sanity]', msg);
    }
    function warn(msg) {
      warnings++;
      if (root.console && console.warn) console.warn('[Sources Sanity]', msg);
    }

    if (!Sources || typeof Sources.list !== 'function' || typeof Sources.read !== 'function') {
      warn('Sources registry missing critical API (list/read).');
      return;
    }

    // Build a fast lookup map of registered sources
    var ids = Sources.list();
    var reg = {}, i;
    for (i = 0; i < ids.length; i++) reg[ids[i]] = true;

    // Required sources for Basic + simulator backbone
    var REQUIRED = [
      'chat.messageCount',
      'user.personaName',
      'character.chatName',

      'scenario.raw', 'scenario.norm',
      'personality.raw', 'personality.norm',

      'lastUser.raw', 'lastUser.norm',
      'lastBot.raw', 'lastBot.norm',

      'history.raw', 'history.norm',
      'historyText.raw', 'historyText.norm'
    ];

    // 1) Required registration check
    for (i = 0; i < REQUIRED.length; i++) {
      if (!reg[REQUIRED[i]]) warn('Expected source not registered: "' + REQUIRED[i] + '"');
    }

    // 2) Allowlists only reference known IDs
    var mod;
    for (mod in BASIC_ALLOWLISTS) {
      if (!Object.prototype.hasOwnProperty.call(BASIC_ALLOWLISTS, mod)) continue;

      var list = concat(BASIC_ALLOWLISTS[mod], ID_SOURCES);
      var j;
      for (j = 0; j < list.length; j++) {
        if (!reg[list[j]]) {
          warn('Allowlist for module "' + mod + '" references unknown sourceId: "' + list[j] + '"');
        }
      }
    }

    // 3) Getter callability check on stub ctx (no exceptions)
    var ctx = (root.Sim && typeof root.Sim.getCtx === 'function') ? root.Sim.getCtx() : buildStubCtx();
    var state = {};
    var derived = {};
    for (i = 0; i < REQUIRED.length; i++) {
      var sid = REQUIRED[i];
      if (!reg[sid]) continue;

      var trace = [];
      Sources.read('__sanity__', sid, ctx, state, derived, { strict: false, trace: trace });

      var k;
      for (k = 0; k < trace.length; k++) {
        if (trace[k] && trace[k].kind === 'sourceError') {
          warn('Source getter threw for "' + sid + '": ' + (trace[k].error || '(unknown error)'));
          break;
        }
      }
    }

    if (warnings === 0) logInfo('OK — registry, allowlists, and getters look valid (stub ctx).');
  }

  // --------------------------------------------------------------------------
  // Init entry point
  // --------------------------------------------------------------------------
  // IMPORTANT: register convenience sources before allowlists + sanity
  registerConvenienceSources();

  if (MODE === 'basic') {
    applyBasicAllowlists();
  }

  runSourcesSanityCheck();

  // Minimal exposed state for future UI layers
  root.AppInit = root.AppInit || {};
  root.AppInit.mode = MODE;

})(window);

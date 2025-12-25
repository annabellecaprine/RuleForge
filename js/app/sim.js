/* ============================================================================
 * sim.js — Simulation Context Helper (Standalone Studio Tool)
 * ----------------------------------------------------------------------------
 * This tool does not talk to JanitorAI. Instead, we SIMULATE a Janitor-like
 * `context` object for testing/evaluation and for explaining why rules fire.
 *
 * Responsibilities:
 *   - Provide a single global place to store a simulated ctx (window.Sim.ctx)
 *   - Provide helpers to set/get messages and core fields safely
 *
 * Non-responsibilities:
 *   - No UI
 *   - No persistence (yet)
 *   - No codegen
 * ============================================================================
 */
(function (root) {
  'use strict';

  function isArr(x) {
    return Object.prototype.toString.call(x) === '[object Array]';
  }

  function cloneJson(o) {
    // Good enough for our simple structures; avoids accidental shared references.
    return JSON.parse(JSON.stringify(o || {}));
  }

  function ensureShape(ctx) {
    if (!ctx) ctx = {};
    if (!ctx.character) ctx.character = {};
    if (!ctx.chat) ctx.chat = {};
    if (!ctx.chat.last_messages || !isArr(ctx.chat.last_messages)) ctx.chat.last_messages = [];
    if (typeof ctx.chat.message_count !== 'number') ctx.chat.message_count = ctx.chat.last_messages.length;
    if (typeof ctx.chat.persona_name !== 'string') ctx.chat.persona_name = 'User';
    if (typeof ctx.character.chat_name !== 'string') ctx.character.chat_name = 'Bot';
    if (typeof ctx.character.scenario !== 'string') ctx.character.scenario = '';
    if (typeof ctx.character.personality !== 'string') ctx.character.personality = '';
    if (typeof ctx.character.example_dialogs !== 'string') ctx.character.example_dialogs = '';
    if (typeof ctx.chat.last_message !== 'string') ctx.chat.last_message = ''; // optional legacy
    return ctx;
  }

  function defaultCtx() {
    return ensureShape({
      character: {
        chat_name: 'Bot',
        personality: '',
        scenario: '',
        example_dialogs: ''
      },
      chat: {
        message_count: 0,
        persona_name: 'User',
        last_message: '',
        last_messages: []
      }
    });
  }

  var Sim = {};

  // The current simulated context object
  Sim.ctx = defaultCtx();

  // Reset to an empty default context
  Sim.reset = function () {
    Sim.ctx = defaultCtx();
    return Sim.ctx;
  };

  // Replace ctx with user-provided object (defensively shaped)
  Sim.setCtx = function (ctx) {
    Sim.ctx = ensureShape(cloneJson(ctx));
    // Keep message_count consistent unless caller explicitly set it
    if (typeof Sim.ctx.chat.message_count !== 'number') {
      Sim.ctx.chat.message_count = Sim.ctx.chat.last_messages.length;
    }
    return Sim.ctx;
  };

  // Safe getter (always returns a correctly shaped ctx)
  Sim.getCtx = function () {
    Sim.ctx = ensureShape(Sim.ctx);
    return Sim.ctx;
  };

  // Set basic character fields
  Sim.setCharacter = function (fields) {
    fields = fields || {};
    var ctx = Sim.getCtx();
    if (typeof fields.chat_name === 'string') ctx.character.chat_name = fields.chat_name;
    if (typeof fields.personality === 'string') ctx.character.personality = fields.personality;
    if (typeof fields.scenario === 'string') ctx.character.scenario = fields.scenario;
    if (typeof fields.example_dialogs === 'string') ctx.character.example_dialogs = fields.example_dialogs;
    return ctx;
  };

  // Set persona name
  Sim.setPersonaName = function (name) {
    var ctx = Sim.getCtx();
    if (typeof name === 'string') ctx.chat.persona_name = name;
    return ctx;
  };

  // Replace message list. Accepts:
  //   - array of strings, OR
  //   - array of {message:"..."} objects
  Sim.setMessages = function (messages) {
    var ctx = Sim.getCtx();
    var out = [], i, m;

    if (!isArr(messages)) messages = [];

    for (i = 0; i < messages.length; i++) {
      m = messages[i];
      if (typeof m === 'string') out.push({ message: m });
      else if (m && typeof m.message === 'string') out.push({ message: m.message });
      else out.push({ message: '' });
    }

    ctx.chat.last_messages = out;
    ctx.chat.message_count = out.length;
    ctx.chat.last_message = out.length ? (out[out.length - 1].message || '') : '';
    return ctx;
  };

  // Push one new user message to the end (simple convenience)
  Sim.pushMessage = function (text) {
    var ctx = Sim.getCtx();
    ctx.chat.last_messages.push({ message: (text == null ? '' : String(text)) });
    ctx.chat.message_count = ctx.chat.last_messages.length;
    ctx.chat.last_message = ctx.chat.last_messages.length ? ctx.chat.last_messages[ctx.chat.last_messages.length - 1].message : '';
    return ctx;
  };
// --- Dev-shape wrapper (non-breaking) ---
// Provides BOTH:
//   ctx.context.chat / ctx.context.character  (dev contract)
//   ctx.chat / ctx.character                  (legacy convenience)
Sim.getDevCtx = function () {
  var legacy = (Sim.getCtx ? Sim.getCtx() : (Sim.ctx || {})) || {};

  // If someone already stored dev-shape, pass it through
  if (legacy && legacy.context && legacy.context.chat && legacy.context.character) return legacy;

  var chat = legacy.chat || {};
  var character = legacy.character || {};

  return {
    context: { chat: chat, character: character },
    chat: chat,
    character: character
  };
};

  // Expose
  root.Sim = Sim;

})(window);

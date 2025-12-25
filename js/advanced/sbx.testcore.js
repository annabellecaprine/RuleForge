(function (root) {
  'use strict';

  var SBX = root.SBX = root.SBX || {};
  SBX.TestCore = SBX.TestCore || {};

  function toStr(x) { return String(x == null ? '' : x); }

  // Normalization used by tests (match your prior harness rules)
  function normalize(str) {
    str = toStr(str).toLowerCase();
    str = str.replace(/[^a-z0-9_\s-]/g, ' ');
    str = str.replace(/[-_]+/g, ' ');
    str = str.replace(/\s+/g, ' ');
    return str.trim();
  }

  // Build a “Janitor-like” context from test inputs
  // Later: extend with sources.* and richer chat metadata.
  function buildContext(inputs) {
    inputs = inputs || {};
    var ctx = { chat: {}, character: {} };

    ctx.character.personality = toStr(inputs.personality);
    ctx.character.scenario = toStr(inputs.scenario);
    ctx.character.example_dialogs = toStr(inputs.example_dialogs);
    ctx.character.memory = inputs.memory || {};

    var msgs = inputs.last_messages || [];
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      out.push({ message: toStr(m && m.message != null ? m.message : m) });
    }
    ctx.chat.last_messages = out;

    ctx.chat.chat_metadata = ctx.chat.chat_metadata || {};
    ctx.chat.chat_metadata.public_message_count = out.length;

    return ctx;
  }

  function buildEnv(appState, ctx) {
    var last = (ctx && ctx.chat && ctx.chat.last_messages) ? ctx.chat.last_messages : [];
    var lastMsg = last.length ? toStr(last[last.length - 1].message) : '';

    var normHist = [];
    for (var i = 0; i < last.length; i++) normHist.push(normalize(toStr(last[i].message)));

    return {
      appState: appState,
      context: ctx,
      messageCount: last.length,
      normLastUserMsg: normalize(lastMsg),
      normHistory: normHist
    };
  }

  SBX.TestCore.normalize = normalize;
  SBX.TestCore.buildContext = buildContext;
  SBX.TestCore.buildEnv = buildEnv;

})(window);

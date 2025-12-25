(function (root) {
  'use strict';

  if (!root.Panels || !root.Panels.register) {
    throw new Error('voices.panel.js requires panels.registry.js loaded first');
  }

  // ----------------- helpers -----------------
  function $(id) { return document.getElementById(id); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }

  function esc(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function lsGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : v; }
    catch (_e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (_e) { }
  }

  // ----------------- constants -----------------
  var MAX_VOICES_BASIC = 5;

  // UI-only state (not exported)
  var UI = {
    activeVoice: 0,
    // per-voice open/closed sections
    // UI.sections[i] = { rails:true, attempt:true, context:false, subtones:true }
    sections: {},
    // per-voice expanded subtone rail: UI.subtoneOpen[i] = index or -1
    subtoneOpen: {}
  };

  function ensureVoicesState(StudioState) {
    if (!StudioState.data) StudioState.data = {};
    if (!StudioState.data.voices) {
      StudioState.data.voices = {
        enabled: true,
        debug: false,
        voices: [],
        activeIndex: 0 // persisted selected voice
      };
    }
    var cfg = StudioState.data.voices;
    if (!isArr(cfg.voices)) cfg.voices = [];
    if (typeof cfg.debug !== 'boolean') cfg.debug = false;
    if (typeof cfg.enabled !== 'boolean') cfg.enabled = true;
    if (typeof cfg.activeIndex !== 'number' || isNaN(cfg.activeIndex)) cfg.activeIndex = 0;

    // Hard-cap for Basic
    if (cfg.voices.length > MAX_VOICES_BASIC) cfg.voices.length = MAX_VOICES_BASIC;
    if (cfg.activeIndex < 0) cfg.activeIndex = 0;
    if (cfg.activeIndex >= cfg.voices.length) cfg.activeIndex = cfg.voices.length ? (cfg.voices.length - 1) : 0;
  }

  function saveVoicesState(StudioState) {
    lsSet('studio.data.voices', JSON.stringify(StudioState.data.voices));
  }

  function loadVoicesState(StudioState) {
    ensureVoicesState(StudioState);
    var raw = lsGet('studio.data.voices', '');
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        StudioState.data.voices = parsed;
        ensureVoicesState(StudioState);
      }
    } catch (_e) { }
  }

  function newVoice() {
    return {
      enabled: true,
      tag: "V",
      characterName: "",
      handle: "",
      baselineMarker: "[VOICE]",
      baselineRail: "",
      cadenceRail: "",
      attempt: { baseChance: 0.60, contentBoost: 0.15, softPenalty: 0.20 },
      ctx: {
        softPhrases: "",
        teachingPhrases: "",
        complimentPhrases: "",
        contentWords: ""
      },
      subtones: [
        { label: "Subtone A", weight: 0.50, rail: "" },
        { label: "Subtone B", weight: 0.35, rail: "" },
        { label: "Subtone C", weight: 0.15, rail: "" }
      ]
    };
  }

  function voiceDisplayName(v, idx) {
    var name = v && v.characterName ? String(v.characterName) : '';
    name = name.replace(/^\s+|\s+$/g, '');
    return 'Voice ' + (idx + 1) + ' — ' + (name ? name : '(Unnamed)');
  }

  // ----------------- script generation helpers -----------------
  function toLines(s) {
    s = String(s || '');
    var lines = s.split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/^\s+|\s+$/g, '');
      if (t) out.push(t.toLowerCase());
    }
    return out;
  }

  function jsStr(s) {
    s = String(s == null ? '' : s);
    s = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    return '"' + s + '"';
  }

  function emitArray(arr) {
    var out = '[';
    for (var i = 0; i < arr.length; i++) {
      if (i) out += ',';
      out += jsStr(arr[i]);
    }
    out += ']';
    return out;
  }

  function emitSubtones(subtones) {
    if (!subtones || !subtones.length) return '[]';
    var out = '[';
    for (var i = 0; i < subtones.length; i++) {
      var st = subtones[i] || {};
      if (i) out += ',';
      out += '{label:' + jsStr(st.label || ('Subtone ' + (i + 1))) +
        ',weight:' + (typeof st.weight === 'number' ? st.weight : 0) +
        ',rail:' + jsStr(st.rail || '') + '}';
    }
    out += ']';
    return out;
  }

  function findAttrNode(startNode, rootNode, attrName) {
    var n = startNode;
    while (n && n !== rootNode) {
      if (n.getAttribute && n.getAttribute(attrName) != null) return n;
      n = n.parentNode;
    }
    return null;
  }

  function generateScript(cfg) {
    if (!cfg || !cfg.enabled) return '';
    var hasActive = false;
    for (var i = 0; i < (cfg.voices || []).length; i++) {
      if (cfg.voices[i] && cfg.voices[i].enabled) { hasActive = true; break; }
    }
    if (!hasActive) return '';

    // ES5 output; Mode 2: run all enabled voices
    var s = '';
    s += '/* === VOICE RAILS (Generated) =========================================== */\n\n';
    s += 'var VOICES_CFG = {\n';
    s += '  enabled: true,\n';
    s += '  debug: ' + (cfg.debug ? 'true' : 'false') + ',\n';
    s += '  voices: [\n';

    for (var i = 0; i < cfg.voices.length; i++) {
      var v = cfg.voices[i];
      if (!v) continue;

      var soft = emitArray(toLines(v.ctx && v.ctx.softPhrases));
      var teach = emitArray(toLines(v.ctx && v.ctx.teachingPhrases));
      var comp = emitArray(toLines(v.ctx && v.ctx.complimentPhrases));
      var cont = emitArray(toLines(v.ctx && v.ctx.contentWords));

      s += '    {\n';
      s += '      enabled: ' + (v.enabled ? 'true' : 'false') + ',\n';
      s += '      tag: ' + jsStr(v.tag || 'V') + ',\n';
      s += '      characterName: ' + jsStr(v.characterName || '') + ',\n';
      s += '      handle: ' + jsStr(v.handle || '') + ',\n';
      s += '      attempt: {\n';
      s += '        baseChance: ' + (v.attempt && typeof v.attempt.baseChance === 'number' ? v.attempt.baseChance : 0.6) + ',\n';
      s += '        contentBoost: ' + (v.attempt && typeof v.attempt.contentBoost === 'number' ? v.attempt.contentBoost : 0.15) + ',\n';
      s += '        softPenalty: ' + (v.attempt && typeof v.attempt.softPenalty === 'number' ? v.attempt.softPenalty : 0.20) + '\n';
      s += '      },\n';
      s += '      ctx: {\n';
      s += '        softPhrases: ' + soft + ',\n';
      s += '        teachingPhrases: ' + teach + ',\n';
      s += '        complimentPhrases: ' + comp + ',\n';
      s += '        contentWords: ' + cont + '\n';
      s += '      },\n';
      s += '      baselineMarker: ' + jsStr(v.baselineMarker || '[VOICE]') + ',\n';
      s += '      baselineRail: ' + jsStr(v.baselineRail || '') + ',\n';
      s += '      cadenceRail: ' + jsStr(v.cadenceRail || '') + ',\n';
      s += '      subtones: ' + emitSubtones(v.subtones) + '\n';
      s += '    }' + (i === cfg.voices.length - 1 ? '\n' : ',\n');
    }

    s += '  ]\n';
    s += '};\n\n';

    s += 'function vr_msgLower(context){\n';
    s += '  var raw = \"\";\n';
    s += '  if (context && context.chat && context.chat.last_message) raw = String(context.chat.last_message);\n';
    s += '  return raw.toLowerCase();\n';
    s += '}\n\n';

    s += 'function vr_hasAnyPhrase(msg, list){\n';
    s += '  if (!msg || !list || !list.length) return false;\n';
    s += '  for (var i=0;i<list.length;i++) if (msg.indexOf(list[i]) !== -1) return true;\n';
    s += '  return false;\n';
    s += '}\n\n';

    s += 'function vr_hasAnyWord(msg, list){\n';
    s += '  if (!msg || !list || !list.length) return false;\n';
    s += '  var padded = \" \" + msg + \" \";\n';
    s += '  for (var i=0;i<list.length;i++){\n';
    s += '    var w = list[i];\n';
    s += '    if (padded.indexOf(\" \" + w + \" \") !== -1) return true;\n';
    s += '  }\n';
    s += '  return false;\n';
    s += '}\n\n';

    s += 'function vr_clamp(v,min,max){ if (v<min) return min; if (v>max) return max; return v; }\n\n';

    s += 'function vr_appendPersonality(context, txt){\n';
    s += '  if (!txt) return;\n';
    s += '  if (!context || !context.character) return;\n';
    s += '  if (typeof context.character.personality !== \"string\") context.character.personality = \"\";\n';
    s += '  context.character.personality += \" \" + txt;\n';
    s += '}\n\n';

    s += 'function vr_debugCrumb(context, vcfg, crumb){\n';
    s += '  if (!VOICES_CFG.debug) return;\n';
    s += '  if (!context || !context.character) return;\n';
    s += '  if (typeof context.character.scenario !== \"string\") context.character.scenario = \"\";\n';
    s += '  var tag = (vcfg && vcfg.tag) ? vcfg.tag : \"VR\";\n';
    s += '  context.character.scenario += \" [\" + tag + \":\" + crumb + \"]\";\n';
    s += '}\n\n';

    s += 'function vr_pickSubtone(subtones){\n';
    s += '  if (!subtones || !subtones.length) return null;\n';
    s += '  var sum = 0;\n';
    s += '  for (var i=0;i<subtones.length;i++){\n';
    s += '    var w = subtones[i] && typeof subtones[i].weight === \"number\" ? subtones[i].weight : 0;\n';
    s += '    if (w > 0) sum += w;\n';
    s += '  }\n';
    s += '  if (sum <= 0) return subtones[0];\n';
    s += '  var r = Math.random() * sum;\n';
    s += '  var acc = 0;\n';
    s += '  for (i=0;i<subtones.length;i++){\n';
    s += '    w = subtones[i] && typeof subtones[i].weight === \"number\" ? subtones[i].weight : 0;\n';
    s += '    if (w <= 0) continue;\n';
    s += '    acc += w;\n';
    s += '    if (r <= acc) return subtones[i];\n';
    s += '  }\n';
    s += '  return subtones[subtones.length-1];\n';
    s += '}\n\n';

    s += 'function vr_runVoice(context, msg, vcfg){\n';
    s += '  if (!vcfg || !vcfg.enabled) return;\n';
    s += '  if (!context.character) context.character = {};\n';
    s += '  if (typeof context.character.personality !== \"string\") context.character.personality = \"\";\n';
    s += '  if (typeof context.character.scenario !== \"string\") context.character.scenario = \"\";\n\n';
    s += '  if (vcfg.baselineMarker && vcfg.baselineRail && context.character.personality.indexOf(vcfg.baselineMarker) === -1){\n';
    s += '    vr_appendPersonality(context, vcfg.baselineRail);\n';
    s += '    vr_debugCrumb(context, vcfg, \"BASE\");\n';
    s += '  }\n\n';
    s += '  if (vcfg.cadenceRail) vr_appendPersonality(context, vcfg.cadenceRail);\n\n';
    s += '  var ctx = vcfg.ctx || {};\n';
    s += '  var isSoft = ctx.softPhrases && ctx.softPhrases.length ? vr_hasAnyPhrase(msg, ctx.softPhrases) : false;\n';
    s += '  var isTeach = ctx.teachingPhrases && ctx.teachingPhrases.length ? vr_hasAnyPhrase(msg, ctx.teachingPhrases) : false;\n';
    s += '  var isComp = ctx.complimentPhrases && ctx.complimentPhrases.length ? vr_hasAnyPhrase(msg, ctx.complimentPhrases) : false;\n';
    s += '  var isCont = ctx.contentWords && ctx.contentWords.length ? (vr_hasAnyPhrase(msg, ctx.contentWords) || vr_hasAnyWord(msg, ctx.contentWords)) : false;\n\n';
    s += '  if (isSoft) vr_debugCrumb(context, vcfg, \"SOFT\");\n';
    s += '  if (isTeach) vr_debugCrumb(context, vcfg, \"TEACH\");\n';
    s += '  if (isComp) vr_debugCrumb(context, vcfg, \"COMPL\");\n';
    s += '  if (isCont) vr_debugCrumb(context, vcfg, \"CONTENT\");\n\n';
    s += '  var a = vcfg.attempt || {};\n';
    s += '  var chance = (typeof a.baseChance === \"number\") ? a.baseChance : 0.6;\n';
    s += '  if (isCont && typeof a.contentBoost === \"number\") chance += a.contentBoost;\n';
    s += '  if (isSoft && typeof a.softPenalty === \"number\") chance -= a.softPenalty;\n';
    s += '  chance = vr_clamp(chance, 0.10, 0.95);\n';
    s += '  var will = (Math.random() < chance);\n';
    s += '  vr_debugCrumb(context, vcfg, will ? \"ATT:Y\" : \"ATT:N\");\n';
    s += '  if (!will) return;\n\n';
    s += '  var st = vr_pickSubtone(vcfg.subtones);\n';
    s += '  if (st && st.rail) {\n';
    s += '    vr_debugCrumb(context, vcfg, \"ST:\" + (st.label || \"?\"));\n';
    s += '    vr_appendPersonality(context, st.rail);\n';
    s += '  }\n';
    s += '}\n\n';

    s += '(function(){\n';
    s += '  if (!VOICES_CFG || !VOICES_CFG.enabled) return;\n';
    s += '  if (!context || !context.chat) return;\n';
    s += '  var msg = vr_msgLower(context);\n';
    s += '  if (!msg) return;\n';
    s += '  if (!context.character) context.character = {};\n';
    s += '  if (typeof context.character.personality !== \"string\") context.character.personality = \"\";\n';
    s += '  if (typeof context.character.scenario !== \"string\") context.character.scenario = \"\";\n';
    s += '  var voices = VOICES_CFG.voices || [];\n';
    s += '  for (var i=0;i<voices.length;i++){\n';
    s += '    if (!voices[i] || !voices[i].enabled) continue;\n';
    s += '    vr_runVoice(context, msg, voices[i]);\n';
    s += '  }\n';
    s += '})();\n';

    return s;
  }

  // ----------------- UI rendering -----------------
  function getSectionState(voiceIndex) {
    if (!UI.sections[voiceIndex]) {
      UI.sections[voiceIndex] = { rails: true, attempt: true, context: false, subtones: true };
    }
    return UI.sections[voiceIndex];
  }

  function setActiveVoice(StudioState, idx) {
    var cfg = StudioState.data.voices;
    if (idx < 0) idx = 0;
    if (idx >= cfg.voices.length) idx = cfg.voices.length ? (cfg.voices.length - 1) : 0;
    UI.activeVoice = idx;
    cfg.activeIndex = idx;
    saveVoicesState(StudioState);
  }

  function render(rootEl, StudioState) {
    var cfg = StudioState.data.voices;

    UI.activeVoice = (typeof cfg.activeIndex === 'number' ? cfg.activeIndex : 0);
    if (UI.activeVoice < 0) UI.activeVoice = 0;
    if (UI.activeVoice >= cfg.voices.length) UI.activeVoice = cfg.voices.length ? (cfg.voices.length - 1) : 0;

    var warnCap = (cfg.voices.length >= MAX_VOICES_BASIC);
    var active = cfg.voices[UI.activeVoice] || null;

    var html = '';
    html += '<div class="vc-shell">';

    // Top controls
    html += '  <div class="vc-top eng-block">';
    html += '    <div class="vc-top-row">';
    html += '      <div class="vc-top-left">';
    html += '        <div class="eng-h">Voices</div>';
    html += '        <div class="eng-muted">Basic mode is optimized for up to ' + MAX_VOICES_BASIC + ' voices to avoid diluted voice control. Advanced can go further if needed.</div>';
    html += '      </div>';
    html += '      <div class="vc-top-right">';
    html += '        <label class="pill pill-warn" style="cursor:pointer;"><input type="checkbox" id="vc-debug" ' + (cfg.debug ? 'checked' : '') + ' /> Debug crumbs</label>';
    html += '        <button class="btn btn-ghost" type="button" id="vc-add">+ Add Voice</button>';
    html += '      </div>';
    html += '    </div>';

    if (warnCap) {
      html += '    <div class="vc-warn">';
      html += '      <b>Limit reached:</b> Basic Voices is capped at ' + MAX_VOICES_BASIC + ' voices. Beyond that, coherence and control usually degrade. Use Advanced for larger casts.';
      html += '    </div>';
    }

    html += '  </div>'; // top

    // Body
    html += '  <div class="vc-body">';

    // Left tabs
    html += '    <div class="vc-tabs eng-block">';
    html += '      <div class="eng-h">Voice Tabs</div>';
    html += '      <div class="vc-tablist">';

    if (!cfg.voices.length) {
      html += '        <div class="eng-muted" style="margin-bottom:12px;">(no voices yet)</div>' +
        '        <button class="btn btn-primary" type="button" id="vc-add-empty">+ Add Your First Voice</button>';
    } else {
      for (var i = 0; i < cfg.voices.length; i++) {
        var v = cfg.voices[i];
        var on = !!(v && v.enabled);
        var name = voiceDisplayName(v, i);
        var stCount = v && v.subtones ? v.subtones.length : 0;

        html += '        <button class="vc-tab' + (i === UI.activeVoice ? ' is-active' : '') + '" type="button" data-vc-tab="' + i + '">';
        html += '          <span class="vc-dot ' + (on ? 'on' : 'off') + '" aria-hidden="true" title="' + (on ? 'Enabled' : 'Disabled') + '"></span>';
        html += '          <span class="vc-tab-name">' + esc(name) + '</span>';
        html += '          <span class="vc-tab-meta">' + esc(String(stCount)) + ' subtones</span>';
        html += '        </button>';
      }
    }

    html += '      </div>';
    html += '    </div>'; // tabs

    // Right editor
    html += '    <div class="vc-editor eng-block">';

    if (!active) {
      html += '      <div class="eng-h">Editor</div>';
      html += '      <div class="eng-muted" style="margin-bottom:12px;">Add a voice to begin.</div>';
    } else {
      var header = voiceDisplayName(active, UI.activeVoice);
      html += '      <div class="vc-editor-head">';
      html += '        <div class="eng-h">' + esc(header) + '</div>';
      html += '        <div class="vc-editor-actions">';
      html += '          <label class="pill pill-ok" style="cursor:pointer;"><input type="checkbox" data-vc-en="' + UI.activeVoice + '" ' + (active.enabled ? 'checked' : '') + ' /> Enabled</label>';
      html += '          <button class="btn btn-ghost" type="button" data-vc-del="' + UI.activeVoice + '">Remove</button>';
      html += '        </div>';
      html += '      </div>';

      // Compact grid for identity
      html += '      <div class="vc-grid2">';
      html += '        <div>';
      html += '          <label class="eng-lab">Character Name</label>';
      html += '          <input class="inp" data-vc-name="' + UI.activeVoice + '" value="' + esc(active.characterName || '') + '" />';
      html += '        </div>';
      html += '        <div class="vc-row2">';
      html += '          <div>';
      html += '            <label class="eng-lab">Tag</label>';
      html += '            <input class="inp" style="width:100%;" data-vc-tag="' + UI.activeVoice + '" value="' + esc(active.tag || '') + '" />'; // FIX
      html += '          </div>';
      html += '          <div>';
      html += '            <label class="eng-lab">Handle</label>';
      html += '            <input class="inp" style="width:100%;" data-vc-handle="' + UI.activeVoice + '" value="' + esc(active.handle || '') + '" />'; // FIX
      html += '          </div>';
      html += '        </div>';
      html += '      </div>';

      // Collapsible sections
      var sec = getSectionState(UI.activeVoice);

      html += renderSectionHeader('Rails', 'rails', sec.rails);
      if (sec.rails) {
        html += '      <div class="vc-section">';
        html += '        <div class="vc-row2">';
        html += '          <div>';
        html += '            <label class="eng-lab">Baseline Marker</label>';
        html += '            <input class="inp" data-vc-marker="' + UI.activeVoice + '" value="' + esc(active.baselineMarker || '') + '" />';
        html += '          </div>';
        html += '          <div class="eng-muted" style="align-self:end;">Used to avoid inserting baseline twice.</div>';
        html += '        </div>';
        html += '        <label class="eng-lab">Baseline Rail</label>';
        html += '        <textarea class="inp vc-ta" rows="3" data-vc-baseline="' + UI.activeVoice + '">' + esc(active.baselineRail || '') + '</textarea>';
        html += '        <label class="eng-lab">Cadence Rail</label>';
        html += '        <textarea class="inp vc-ta" rows="2" data-vc-cadence="' + UI.activeVoice + '">' + esc(active.cadenceRail || '') + '</textarea>';
        html += '      </div>';
      }

      html += renderSectionHeader('Attempt', 'attempt', sec.attempt);
      if (sec.attempt) {
        var a = active.attempt || {};
        html += '      <div class="vc-section">';
        html += '        <div class="vc-row3">';
        html += '          <div><label class="eng-lab">Base</label><input class="inp inp-num" type="number" step="0.01" min="0" max="1" data-vc-bc="' + UI.activeVoice + '" value="' + esc(String(a.baseChance)) + '" /></div>';
        html += '          <div><label class="eng-lab">Content +</label><input class="inp inp-num" type="number" step="0.01" min="0" max="1" data-vc-cb="' + UI.activeVoice + '" value="' + esc(String(a.contentBoost)) + '" /></div>';
        html += '          <div><label class="eng-lab">Soft −</label><input class="inp inp-num" type="number" step="0.01" min="0" max="1" data-vc-sp="' + UI.activeVoice + '" value="' + esc(String(a.softPenalty)) + '" /></div>';
        html += '        </div>';
        html += '      </div>';
      }

      html += renderSectionHeader('Context', 'context', sec.context);
      if (sec.context) {
        var c = active.ctx || {};
        html += '      <div class="vc-section">';
        html += '        <div class="vc-row2">';
        html += '          <div><label class="eng-lab">Soft phrases (one per line)</label><textarea class="inp vc-ta" rows="3" data-vc-soft="' + UI.activeVoice + '">' + esc(c.softPhrases || '') + '</textarea></div>';
        html += '          <div><label class="eng-lab">Teaching phrases</label><textarea class="inp vc-ta" rows="3" data-vc-teach="' + UI.activeVoice + '">' + esc(c.teachingPhrases || '') + '</textarea></div>';
        html += '        </div>';
        html += '        <div class="vc-row2">';
        html += '          <div><label class="eng-lab">Compliment phrases</label><textarea class="inp vc-ta" rows="3" data-vc-comp="' + UI.activeVoice + '">' + esc(c.complimentPhrases || '') + '</textarea></div>';
        html += '          <div><label class="eng-lab">Content words</label><textarea class="inp vc-ta" rows="3" data-vc-cont="' + UI.activeVoice + '">' + esc(c.contentWords || '') + '</textarea></div>';
        html += '        </div>';
        html += '      </div>';
      }

      html += renderSectionHeader('Subtones', 'subtones', sec.subtones);
      if (sec.subtones) {
        var sts = active.subtones || [];
        var openIdx = (typeof UI.subtoneOpen[UI.activeVoice] === 'number') ? UI.subtoneOpen[UI.activeVoice] : -1;

        html += '      <div class="vc-section">';
        html += '        <div class="eng-muted">Compact list. Click <b>Edit</b> to expand a subtone’s rail.</div>';

        if (!sts.length) {
          html += '        <div class="eng-muted">(no subtones yet)</div>';
        } else {
          html += '        <div class="vc-st-list">';
          for (var si = 0; si < sts.length; si++) {
            var st = sts[si] || {};
            html += '          <div class="vc-st-row">';
            html += '            <div class="vc-st-main">';
            html += '              <input class="inp vc-st-lab" data-st-lab="' + UI.activeVoice + ':' + si + '" value="' + esc(st.label || '') + '" />';
            html += '              <input class="inp inp-num vc-st-w" type="number" step="0.01" min="0" data-st-w="' + UI.activeVoice + ':' + si + '" value="' + esc(String(st.weight || 0)) + '" />';
            html += '              <button class="btn btn-ghost vc-mini" type="button" data-st-edit="' + UI.activeVoice + ':' + si + '">' + (openIdx === si ? 'Close' : 'Edit') + '</button>';
            html += '              <button class="btn btn-ghost vc-mini" type="button" data-st-del="' + UI.activeVoice + ':' + si + '">Remove</button>';
            html += '            </div>';

            if (openIdx === si) {
              html += '            <div class="vc-st-rail">';
              html += '              <label class="eng-lab">Rail</label>';
              html += '              <textarea class="inp vc-ta" rows="3" data-st-rail="' + UI.activeVoice + ':' + si + '">' + esc(st.rail || '') + '</textarea>';
              html += '            </div>';
            }

            html += '          </div>';
          }
          html += '        </div>';
        }

        html += '        <div class="eng-row">';
        html += '          <button class="btn btn-ghost" type="button" data-st-add="' + UI.activeVoice + '">+ Add Subtone</button>';
        html += '        </div>';

        html += '      </div>';
      }

      // Preview
      html += '      <div class="vc-preview">';
      html += '        <div class="vc-preview-head">';
      html += '          <div class="eng-h" style="margin:0;">Generated Script (preview)</div>';
      html += '          <button class="btn btn-ghost vc-mini" type="button" id="vc-copy">Copy</button>';
      html += '        </div>';
      html += '        <textarea class="inp vc-ta" rows="7" id="vc-preview" readonly></textarea>';
      html += '      </div>';
    }

    html += '    </div>'; // editor
    html += '  </div>'; // body

    html += '</div>'; // shell

    rootEl.innerHTML = html;

    // wire globals
    var dbg = $('vc-debug');
    if (dbg) dbg.onchange = function () {
      cfg.debug = !!dbg.checked;
      saveVoicesState(StudioState);
      updatePreview();
    };

    var add = $('vc-add');
    if (add) add.onclick = function () {
      if (cfg.voices.length >= MAX_VOICES_BASIC) {
        render(rootEl, StudioState);
        return;
      }
      cfg.voices.push(newVoice());
      setActiveVoice(StudioState, cfg.voices.length - 1);
      saveVoicesState(StudioState);
      render(rootEl, StudioState);
    };

    var addEmpty = $('vc-add-empty');
    if (addEmpty) addEmpty.onclick = function () {
      if (add) add.click();
    };

    var copyBtn = $('vc-copy');
    if (copyBtn) copyBtn.onclick = function () {
      var ta = $('vc-preview');
      if (!ta) return;
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (_e) { }
    };

    // Click delegation
    rootEl.onclick = function (ev) {
      ev = ev || window.event;
      var t = ev.target || ev.srcElement;
      if (!t || !t.getAttribute) return;

      var tabNode = findAttrNode(t, rootEl, 'data-vc-tab');
      if (tabNode) {
        var tab = tabNode.getAttribute('data-vc-tab');
        var idx = parseInt(tab, 10);
        if (!isNaN(idx)) {
          setActiveVoice(StudioState, idx);
          render(rootEl, StudioState);
        }
        return;
      }

      var del = t.getAttribute('data-vc-del');
      if (del != null) {
        var d = parseInt(del, 10);
        if (!isNaN(d)) {
          cfg.voices.splice(d, 1);
          if (cfg.voices.length > MAX_VOICES_BASIC) cfg.voices.length = MAX_VOICES_BASIC;
          if (cfg.activeIndex >= cfg.voices.length) cfg.activeIndex = cfg.voices.length ? (cfg.voices.length - 1) : 0;
          saveVoicesState(StudioState);
          render(rootEl, StudioState);
        }
        return;
      }

      var sec = t.getAttribute('data-vc-sec');
      if (sec) {
        var parts = sec.split(':');
        var vi = parseInt(parts[0], 10);
        var key = parts[1];
        if (!isNaN(vi) && key) {
          var st = getSectionState(vi);
          st[key] = !st[key];
          render(rootEl, StudioState);
        }
        return;
      }

      var stAdd = t.getAttribute('data-st-add');
      if (stAdd != null) {
        var vix = parseInt(stAdd, 10);
        if (!isNaN(vix) && cfg.voices[vix]) {
          cfg.voices[vix].subtones = cfg.voices[vix].subtones || [];
          cfg.voices[vix].subtones.push({ label: 'New Subtone', weight: 0.25, rail: '' });
          saveVoicesState(StudioState);
          render(rootEl, StudioState);
        }
        return;
      }

      var stDel = t.getAttribute('data-st-del');
      if (stDel) {
        var p = stDel.split(':');
        var vi2 = parseInt(p[0], 10);
        var si2 = parseInt(p[1], 10);
        if (!isNaN(vi2) && !isNaN(si2) && cfg.voices[vi2] && cfg.voices[vi2].subtones) {
          cfg.voices[vi2].subtones.splice(si2, 1);
          if (UI.subtoneOpen[vi2] === si2) UI.subtoneOpen[vi2] = -1;
          saveVoicesState(StudioState);
          render(rootEl, StudioState);
        }
        return;
      }

      var stEdit = t.getAttribute('data-st-edit');
      if (stEdit) {
        var p2 = stEdit.split(':');
        var vi3 = parseInt(p2[0], 10);
        var si3 = parseInt(p2[1], 10);
        if (!isNaN(vi3) && !isNaN(si3)) {
          var cur = (typeof UI.subtoneOpen[vi3] === 'number') ? UI.subtoneOpen[vi3] : -1;
          UI.subtoneOpen[vi3] = (cur === si3 ? -1 : si3);
          render(rootEl, StudioState);
        }
      }
    };

    // Change delegation (inputs)
    rootEl.onchange = function (ev) {
      ev = ev || window.event;
      var t = ev.target || ev.srcElement;
      if (!t || !t.getAttribute) return;

      function vAt(i) { return cfg.voices[i]; }
      function setV(i, key, val) {
        if (!vAt(i)) return;
        vAt(i)[key] = val;
      }
      function setA(i, key, val) {
        if (!vAt(i)) return;
        vAt(i).attempt = vAt(i).attempt || {};
        vAt(i).attempt[key] = val;
      }
      function setC(i, key, val) {
        if (!vAt(i)) return;
        vAt(i).ctx = vAt(i).ctx || {};
        vAt(i).ctx[key] = val;
      }

      var en = t.getAttribute('data-vc-en');
      if (en != null) {
        var idx = parseInt(en, 10);
        if (!isNaN(idx) && vAt(idx)) {
          vAt(idx).enabled = !!t.checked;
          saveVoicesState(StudioState);
          updatePreview();
          render(rootEl, StudioState);
        }
        return;
      }

      var iStr;

      iStr = t.getAttribute('data-vc-name');
      if (iStr != null) { setV(+iStr, 'characterName', t.value); saveVoicesState(StudioState); render(rootEl, StudioState); return; }

      iStr = t.getAttribute('data-vc-tag');
      if (iStr != null) { setV(+iStr, 'tag', t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-handle');
      if (iStr != null) { setV(+iStr, 'handle', t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-marker');
      if (iStr != null) { setV(+iStr, 'baselineMarker', t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-baseline');
      if (iStr != null) { setV(+iStr, 'baselineRail', t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-cadence');
      if (iStr != null) { setV(+iStr, 'cadenceRail', t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-bc');
      if (iStr != null) { setA(+iStr, 'baseChance', +t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-cb');
      if (iStr != null) { setA(+iStr, 'contentBoost', +t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-sp');
      if (iStr != null) { setA(+iStr, 'softPenalty', +t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-soft');
      if (iStr != null) { setC(+iStr, 'softPhrases', t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-teach');
      if (iStr != null) { setC(+iStr, 'teachingPhrases', t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-comp');
      if (iStr != null) { setC(+iStr, 'complimentPhrases', t.value); saveVoicesState(StudioState); updatePreview(); return; }

      iStr = t.getAttribute('data-vc-cont');
      if (iStr != null) { setC(+iStr, 'contentWords', t.value); saveVoicesState(StudioState); updatePreview(); return; }

      var key = t.getAttribute('data-st-lab') || t.getAttribute('data-st-w') || t.getAttribute('data-st-rail');
      if (key) {
        var parts = key.split(':');
        var vi = parseInt(parts[0], 10);
        var si = parseInt(parts[1], 10);
        if (!isNaN(vi) && !isNaN(si) && cfg.voices[vi] && cfg.voices[vi].subtones && cfg.voices[vi].subtones[si]) {
          if (t.getAttribute('data-st-lab')) cfg.voices[vi].subtones[si].label = t.value;
          if (t.getAttribute('data-st-w')) cfg.voices[vi].subtones[si].weight = +t.value;
          if (t.getAttribute('data-st-rail')) cfg.voices[vi].subtones[si].rail = t.value;
          saveVoicesState(StudioState);
          updatePreview();
        }
      }
    };

    function updatePreview() {
      var prev = $('vc-preview');
      if (!prev) return;
      var code = generateScript(cfg);
      if (!code) {
        prev.value = '/* Voices module is either disabled or has no enabled voices. */';
        return;
      }
      prev.value = code;
    }

    updatePreview();
  }

  function renderSectionHeader(label, key, open) {
    var vi = UI.activeVoice;
    return (
      '<button class="vc-sec-h" type="button" data-vc-sec="' + vi + ':' + key + '">' +
      '<span class="vc-caret" aria-hidden="true">' + (open ? '▾' : '▸') + '</span>' +
      '<span class="vc-sec-title">' + esc(label) + '</span>' +
      '</button>'
    );
  }

  root.Panels.register({
    id: 'voices',

    mount: function (rootEl, StudioState) {
      ensureVoicesState(StudioState);
      loadVoicesState(StudioState);
      injectCssOnce();
      render(rootEl, StudioState);
    },

    getRuleSpecs: function (_studioState) {
      return [];
    },

    getExportBlocks: function (StudioState) {
      ensureVoicesState(StudioState);
      var cfg = StudioState.data.voices;
      return [{
        kind: 'script',
        id: 'voices.rails',
        code: generateScript(cfg)
      }];
    },

    getWriteTargets: function (StudioState) {
      ensureVoicesState(StudioState);
      var cfg = StudioState.data.voices;
      var targets = ['context.character.personality'];
      if (cfg.debug) targets.push('context.character.scenario');
      return targets;
    }
  });

  function injectCssOnce() {
    if (document.getElementById('voices-panel-css')) return;

    var css = ""
      + ".vc-shell{display:block}"
      + ".vc-body{display:grid;grid-template-columns:280px 1fr;gap:12px;align-items:start}"
      + ".vc-top-row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}"
      + ".vc-top-right{display:flex;gap:10px;align-items:center;flex-wrap:wrap}"
      + ".vc-warn{margin-top:10px;padding:10px;border:1px solid rgba(201,164,106,.45);border-radius:12px;background:rgba(201,164,106,.12);color:var(--text);font-weight:800;font-size:12px}"
      + ".vc-tablist{display:flex;flex-direction:column;gap:8px;margin-top:10px}"
      + ".vc-tab{width:100%;text-align:left;border:1px solid var(--border);background:rgba(43,33,27,.25);border-radius:12px;padding:10px;cursor:pointer;display:flex;flex-direction:column;gap:4px}"
      + ".vc-tab.is-active{outline:2px solid rgba(201,164,106,.55);background:rgba(43,33,27,.35)}"
      + ".vc-dot{width:10px;height:10px;border-radius:999px;border:1px solid rgba(0,0,0,.35);display:inline-block;margin-right:8px;vertical-align:middle}"
      + ".vc-dot.on{background:var(--on)}"
      + ".vc-dot.off{background:var(--off)}"
      + ".vc-tab-name{font-weight:900}"
      + ".vc-tab{color:var(--text)}"
      + ".vc-tab-name{color:var(--text)}"
      + ".vc-tab-meta{color:var(--muted)}"
      + ".vc-tab-meta{color:var(--muted);font-weight:900;font-size:12px}"
      + ".vc-editor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}"
      + ".vc-editor-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}"
      + ".vc-grid2{display:grid;grid-template-columns:1fr;gap:10px;margin-top:8px}"
      + ".vc-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}"
      + ".vc-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}"
      + ".vc-row2>div{min-width:0}"  /* FIX */
      + ".vc-row3>div{min-width:0}"  /* FIX (safety) */
      + ".vc-sec-h{margin-top:12px;width:100%;text-align:left;border:1px solid var(--border);background:rgba(0,0,0,.05);border-radius:12px;padding:10px;cursor:pointer;display:flex;gap:10px;align-items:center}"
      + ".vc-sec-title{font-weight:900}"
      + ".vc-section{margin-top:10px}"
      + ".vc-ta{width:100%;resize:vertical;min-height:60px}"
      + ".vc-preview{margin-top:12px}"
      + ".vc-preview-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}"
      + ".vc-mini{padding:6px 10px;border-radius:10px}"
      + ".vc-st-list{display:flex;flex-direction:column;gap:10px;margin-top:10px}"
      + ".vc-st-row{border:1px solid var(--border);border-radius:12px;padding:10px;background:rgba(43,33,27,.25)}"
      + ".vc-st-main{display:grid;grid-template-columns:1fr 120px auto auto;gap:8px;align-items:center}"
      + ".vc-st-lab{width:100%}"
      + ".vc-st-w{width:120px}"
      + ".vc-st-rail{margin-top:10px}"
      + "@media (max-width: 980px){.vc-body{grid-template-columns:1fr}.vc-row2{grid-template-columns:1fr}.vc-row3{grid-template-columns:1fr}.vc-st-main{grid-template-columns:1fr 120px auto}}"
      ;

    var style = document.createElement('style');
    style.id = 'voices-panel-css';
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

})(window);

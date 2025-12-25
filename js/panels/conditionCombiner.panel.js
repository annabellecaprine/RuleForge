/* conditionCombiner.panel.js — Combined (ES5), DSL-first
 * Model:
 * - Left tabs: Combined Rules
 * - Right editor: write target + context field + 3 optional conditions
 *   1) Keywords (with filters)
 *   2) Message Count Window (min + optional max)
 *   3) Scoring reference (pick a Scoring topic group; require pass)
 *
 * Notes:
 * - Reads message history via historyText.norm (same convenience source)
 * - Scoring dropdown reads StudioState.data.scoring.topics
 * - DSL output uses when:{op:'and', items:[...]}
 *
 * CSS:
 * - Lorebook-style classes (lb-*) are expected to come from global panels.css
 *   (No per-panel style injection.)
 *
 * Export:
 * - Adds a Generated Script (preview) block like other pages.
 */
(function (root) {
  'use strict';

  var PANEL_ID = 'conditionCombiner';
  var STORE_KEY = 'studio.data.conditionCombiner';

  // ---------------------------
  // Helpers
  // ---------------------------
  function $(sel, el){ return (el || document).querySelector(sel); }
  function $all(sel, el){ return (el || document).querySelectorAll(sel); }
  function esc(s){
    s = (s==null ? '' : String(s));
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function uid(prefix){
    return (prefix||'c') + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
  function clone(x){ try{ return JSON.parse(JSON.stringify(x||{})); }catch(_e){ return {}; } }
  function lsGet(k, fb){ try{ var v=localStorage.getItem(k); return v==null?fb:v; }catch(_e){ return fb; } }
  function lsSet(k, v){ try{ localStorage.setItem(k,v); }catch(_e){} }
  function toInt(v, d){ v=parseInt(v,10); return isNaN(v)?d:v; }
  function clampInt(n, lo, hi){
    n = toInt(n, lo);
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }
  function trim(s){ return String(s==null?'':s).replace(/^\s+|\s+$/g,''); }
  function nonEmpty(s){ return !!trim(s); }

  function ensureStudioState(){
    root.StudioState = root.StudioState || {};
    root.StudioState.data = root.StudioState.data || {};
    if (!root.StudioState.data[PANEL_ID]) root.StudioState.data[PANEL_ID] = defaultData();
    return root.StudioState;
  }

  function defaultData(){
    return {
      version: 2,
      enabled: true,
      rules: [],
      ui: { activeRuleId: null }
    };
  }

  // ---------------------------
  // Data normalize
  // ---------------------------
  function loadData(){
    var st = ensureStudioState();
    var raw = lsGet(STORE_KEY, '');
    if (raw){
      try{
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') st.data[PANEL_ID] = p;
      }catch(_e){}
    }

    var d = st.data[PANEL_ID] || defaultData();
    d.rules = d.rules || [];
    d.ui = d.ui || { activeRuleId: null };
    if (typeof d.enabled !== 'boolean') d.enabled = true;

    for (var i=0;i<d.rules.length;i++){
      normalizeRule(d.rules[i]);
    }

    ensureActiveRule(d);
    st.data[PANEL_ID] = d;
    return d;
  }

  function saveData(){
    var st = ensureStudioState();
    lsSet(STORE_KEY, JSON.stringify(st.data[PANEL_ID] || defaultData()));
  }

  function normalizeRule(r){
    if (!r) return;

    if (!r.id) r.id = uid('r');
    if (typeof r.enabled !== 'boolean') r.enabled = true;
    if (!r.name) r.name = 'Combined Rule';

    if (!r.writeTargetId) r.writeTargetId = 'character.personality';
    if (r.writeTargetId !== 'character.personality' && r.writeTargetId !== 'character.scenario'){
      r.writeTargetId = 'character.personality';
    }
    if (r.contextFieldText == null) r.contextFieldText = '';

    r.conditions = r.conditions || {};

    // Keywords condition
    if (typeof r.conditions.keywordsEnabled !== 'boolean') r.conditions.keywordsEnabled = true;
    if (r.conditions.keywordsText == null) r.conditions.keywordsText = '';
    r.conditions.filters = r.conditions.filters || {};
    if (typeof r.conditions.filters.caseInsensitive !== 'boolean') r.conditions.filters.caseInsensitive = true;
    if (typeof r.conditions.filters.wholeWord !== 'boolean') r.conditions.filters.wholeWord = true;
    if (typeof r.conditions.filters.allowVariants !== 'boolean') r.conditions.filters.allowVariants = true;
    if (typeof r.conditions.filters.skipNegated !== 'boolean') r.conditions.filters.skipNegated = true;

    // Message count window condition
    if (typeof r.conditions.windowEnabled !== 'boolean') r.conditions.windowEnabled = true;
    if (r.conditions.windowMin == null) r.conditions.windowMin = 1;
    r.conditions.windowMin = clampInt(r.conditions.windowMin, 0, 999999);
    if (typeof r.conditions.windowUseMax !== 'boolean') r.conditions.windowUseMax = false;
    if (r.conditions.windowMax == null) r.conditions.windowMax = r.conditions.windowMin;
    r.conditions.windowMax = clampInt(r.conditions.windowMax, 0, 999999);
    if (r.conditions.windowUseMax && r.conditions.windowMax < r.conditions.windowMin){
      r.conditions.windowMax = r.conditions.windowMin;
    }

    // Scoring condition
    if (typeof r.conditions.scoringEnabled !== 'boolean') r.conditions.scoringEnabled = false;
    if (r.conditions.scoringTopicId == null) r.conditions.scoringTopicId = '';
  }

  function getRuleById(d, id){
    for (var i=0;i<d.rules.length;i++){
      if (d.rules[i] && d.rules[i].id === id) return d.rules[i];
    }
    return null;
  }

  function ensureActiveRule(d){
    if (d.ui && d.ui.activeRuleId && getRuleById(d, d.ui.activeRuleId)) return;
    d.ui.activeRuleId = (d.rules[0] && d.rules[0].id) ? d.rules[0].id : null;
  }

  // ---------------------------
  // Keywords parsing
  // ---------------------------
  function splitKeywords(text){
    var raw = String(text==null?'':text);
    raw = raw.replace(/\r/g, '\n');
    raw = raw.replace(/,/g, '\n');
    var lines = raw.split('\n');
    var out = [];
    for (var i=0;i<lines.length;i++){
      var s = trim(lines[i]);
      if (!s) continue;
      out.push(s);
    }
    return out;
  }

  // ---------------------------
  // Scoring topics lookup (for dropdown)
  // ---------------------------
  function getScoringTopics(){
    var st = ensureStudioState();
    var scoring = st.data && st.data.scoring ? st.data.scoring : null;
    var topics = scoring && scoring.topics ? scoring.topics : [];
    var out = [];
    for (var i=0;i<topics.length;i++){
      var t = topics[i];
      if (!t || !t.id) continue;
      out.push({ id: t.id, name: t.name || 'Topic Group' });
    }
    return out;
  }

  // ---------------------------
  // UI
  // ---------------------------
  function buildShell(el){
    el.innerHTML =
      '<div class="lb-shell">' +

        '<div class="lb-body">' +
          '<div class="lb-tabs eng-block">' +
            '<div class="eng-h">Combined Rules</div>' +
            '<div class="lb-tablist" id="cc-rules"></div>' +
            '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
              '<button class="btn" id="cc-add" type="button">Add Rule</button>' +
              '<button class="btn btn-ghost" id="cc-dup" type="button">Duplicate</button>' +
              '<button class="btn btn-ghost" id="cc-del" type="button">Delete</button>' +
            '</div>' +
          '</div>' +
          '<div class="lb-editor eng-block" id="cc-editor"></div>' +
        '</div>' +

        // Full-span code preview
        '<div class="eng-block" id="cc-preview-wrap" style="margin-top:14px; width:100%;">' +
          '<div class="lb-editor-head" style="margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">' +
            '<div class="eng-h" style="margin:0;">Generated Script (Combined module)</div>' +
            '<div class="lb-editor-actions" style="display:flex; gap:8px; align-items:center;">' +
              '<button class="btn btn-ghost lb-mini" type="button" id="cc-copy">Copy</button>' +
            '</div>' +
          '</div>' +
          '<div class="eng-muted" style="font-size:12px; margin-bottom:8px;">' +
            'Paste-ready export block for testing. (Engine will own final assembly.)' +
          '</div>' +
          '<textarea id="cc-preview" readonly spellcheck="false" ' +
            'style="width:100%; min-height:260px; resize:vertical; box-sizing:border-box; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></textarea>' +
        '</div>' +

      '</div>';
  }

  function renderRuleList(rootEl, d){
    var host = $('#cc-rules', rootEl);
    if (!host) return;

    if (!d.rules.length){
      host.innerHTML = '<div class="eng-muted">(no combined rules yet)</div>';
      return;
    }

    var html = '';
    var active = d.ui.activeRuleId;

    for (var i=0;i<d.rules.length;i++){
      var r = d.rules[i];
      if (!r) continue;
      normalizeRule(r);

      var on = (r.enabled !== false);
      var tgt = (r.writeTargetId === 'character.scenario') ? 'Scenario' : 'Personality';

      var c = r.conditions || {};
      var kwCount = splitKeywords(c.keywordsText).length;
      var win = c.windowEnabled ? ('win ' + clampInt(c.windowMin,0,999999) + (c.windowUseMax ? ('–' + clampInt(c.windowMax,0,999999)) : '+')) : 'no window';
      var scoreTag = c.scoringEnabled ? 'scoring' : 'no scoring';

      html += ''
        + '<button class="lb-tab' + (r.id===active?' is-active':'') + '" type="button" data-id="' + esc(r.id) + '">'
        +   '<div class="lb-tab-top">'
        +     '<span class="lb-dot ' + (on?'on':'off') + '"></span>'
        +     '<span class="lb-tab-name">' + esc(r.name || 'Combined Rule') + '</span>'
        +   '</div>'
        +   '<div class="lb-tab-meta">'
        +     '<span class="lb-chip">→ ' + esc(tgt) + '</span>'
        +     '<span class="lb-chip">' + esc(kwCount + ' kw') + '</span>'
        +     '<span class="lb-chip">' + esc(win) + '</span>'
        +     '<span class="lb-chip">' + esc(scoreTag) + '</span>'
        +   '</div>'
        + '</button>';
    }

    host.innerHTML = html;

    var btns = $all('.lb-tab', host);
    for (var b=0;b<btns.length;b++){
      btns[b].onclick = function(){
        d.ui.activeRuleId = this.getAttribute('data-id');
        saveData();
        renderAll(rootEl, d);
        updatePreview(rootEl);
      };
    }
  }

  function renderEditor(rootEl, d){
    var host = $('#cc-editor', rootEl);
    if (!host) return;

    ensureActiveRule(d);
    var r = d.ui.activeRuleId ? getRuleById(d, d.ui.activeRuleId) : null;
    if (!r){
      host.innerHTML = '<div class="eng-muted">Add a combined rule to begin.</div>';
      return;
    }

    normalizeRule(r);

    var c = r.conditions;
    var scoringTopics = getScoringTopics();
    var scoreOpts = '<option value="">(choose a scoring topic)</option>';
    for (var i=0;i<scoringTopics.length;i++){
      var t = scoringTopics[i];
      scoreOpts += '<option value="' + esc(t.id) + '"' + (c.scoringTopicId===t.id?' selected':'') + '>' + esc(t.name) + '</option>';
    }

    host.innerHTML =
      '<div class="lb-editor-head">' +
        '<div class="eng-h" style="margin:0;">Combined — ' + esc(r.name || 'Combined Rule') + '</div>' +
        '<div class="lb-editor-actions">' +
          '<label class="pill pill-ok" style="cursor:pointer;"><input id="cc-enabled" type="checkbox" ' + ((r.enabled!==false)?'checked':'') + '> Enabled</label>' +
        '</div>' +
      '</div>' +

      '<div style="margin-top:12px;" class="card">' +
        '<div style="padding:12px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">' +
          '<label class="ctl">Rule name <input id="cc-name" type="text" value="' + esc(r.name||'') + '" style="min-width:240px;"></label>' +
          '<label class="ctl">Write target ' +
            '<select id="cc-target">' +
              '<option value="character.personality"' + (r.writeTargetId==='character.personality'?' selected':'') + '>Personality</option>' +
              '<option value="character.scenario"' + (r.writeTargetId==='character.scenario'?' selected':'') + '>Scenario</option>' +
            '</select>' +
          '</label>' +
          '<span class="lb-chip">Logic: ALL enabled conditions must pass</span>' +
        '</div>' +
      '</div>' +

      '<div style="margin-top:12px;" class="card">' +
        '<div style="padding:12px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between;">' +
          '<div style="font-weight:900;">Context field</div>' +
        '</div>' +
        '<div style="padding:12px;">' +
          '<textarea id="cc-context" style="width:100%; min-height:100px; resize:vertical;" placeholder="Text to append when the combined gate passes...">' + esc(r.contextFieldText||'') + '</textarea>' +
        '</div>' +
      '</div>' +

      // Keywords condition
      '<div style="margin-top:12px;" class="card">' +
        '<div style="padding:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;">' +
          '<div style="font-weight:900;">Condition 1 — Keywords</div>' +
          '<label class="pill pill-ok" style="cursor:pointer;"><input id="cc-kw-en" type="checkbox" ' + (c.keywordsEnabled?'checked':'') + '> Enabled</label>' +
        '</div>' +
        '<div style="padding:12px; display:flex; gap:14px; flex-wrap:wrap; align-items:center;">' +
          '<label class="pill pill-ok" style="cursor:pointer;"><input id="cc-kw-case" type="checkbox" ' + (c.filters.caseInsensitive?'checked':'') + '> Case-insensitive</label>' +
          '<label class="pill pill-ok" style="cursor:pointer;"><input id="cc-kw-word" type="checkbox" ' + (c.filters.wholeWord?'checked':'') + '> Whole-word</label>' +
          '<label class="pill pill-ok" style="cursor:pointer;"><input id="cc-kw-var" type="checkbox" ' + (c.filters.allowVariants?'checked':'') + '> Allow variants</label>' +
          '<label class="pill pill-ok" style="cursor:pointer;"><input id="cc-kw-neg" type="checkbox" ' + (c.filters.skipNegated?'checked':'') + '> Skip “not/no/never …”</label>' +
          '<span class="eng-muted" style="font-size:12px;">One per line or comma-separated.</span>' +
        '</div>' +
        '<div style="padding:0 12px 12px 12px;">' +
          '<textarea id="cc-kw" style="width:100%; min-height:95px; resize:vertical;" placeholder="rain&#10;storm">' + esc(c.keywordsText||'') + '</textarea>' +
          '<div class="eng-muted" style="font-size:12px; margin-top:6px;">Reads from historyText.norm</div>' +
        '</div>' +
      '</div>' +

      // Window condition
      '<div style="margin-top:12px;" class="card">' +
        '<div style="padding:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;">' +
          '<div style="font-weight:900;">Condition 2 — Message Count Window</div>' +
          '<label class="pill pill-ok" style="cursor:pointer;"><input id="cc-win-en" type="checkbox" ' + (c.windowEnabled?'checked':'') + '> Enabled</label>' +
        '</div>' +
        '<div style="padding:12px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">' +
          '<label class="ctl">Min message count (≥) <input id="cc-win-min" type="number" min="0" max="999999" step="1" value="' + esc(clampInt(c.windowMin,0,999999)) + '" style="width:140px;"></label>' +
          '<label class="pill pill-ok" style="cursor:pointer;"><input id="cc-win-useMax" type="checkbox" ' + (c.windowUseMax?'checked':'') + '> Use max</label>' +
          '<label class="ctl">Max message count (≤) <input id="cc-win-max" type="number" min="0" max="999999" step="1" value="' + esc(clampInt(c.windowMax,0,999999)) + '" style="width:140px;" ' + (c.windowUseMax?'':'disabled') + '></label>' +
          '<span class="eng-muted" style="font-size:12px;">Uses chat.messageCount</span>' +
        '</div>' +
      '</div>' +

      // Scoring condition
      '<div style="margin-top:12px;" class="card">' +
        '<div style="padding:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;">' +
          '<div style="font-weight:900;">Condition 3 — Scoring</div>' +
          '<label class="pill pill-ok" style="cursor:pointer;"><input id="cc-score-en" type="checkbox" ' + (c.scoringEnabled?'checked':'') + '> Enabled</label>' +
        '</div>' +
        '<div style="padding:12px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">' +
          '<label class="ctl">Scoring topic ' +
            '<select id="cc-score-topic" ' + (c.scoringEnabled?'':'disabled') + '>' + scoreOpts + '</select>' +
          '</label>' +
          '<span class="eng-muted" style="font-size:12px;">Requires selected scoring topic to PASS</span>' +
        '</div>' +
      '</div>';

    // Wire basic
    $('#cc-enabled', host).onchange = function(){ r.enabled = !!this.checked; saveData(); renderRuleList(rootEl, d); updatePreview(rootEl); };
    $('#cc-name', host).oninput = function(){ r.name = this.value; saveData(); renderRuleList(rootEl, d); updatePreview(rootEl); };
    $('#cc-target', host).onchange = function(){
      var v = this.value || 'character.personality';
      if (v !== 'character.personality' && v !== 'character.scenario') v = 'character.personality';
      r.writeTargetId = v;
      saveData();
      renderRuleList(rootEl, d);
      updatePreview(rootEl);
    };
    $('#cc-context', host).oninput = function(){ r.contextFieldText = this.value; saveData(); updatePreview(rootEl); };

    // Wire keywords
    $('#cc-kw-en', host).onchange = function(){ c.keywordsEnabled = !!this.checked; saveData(); renderRuleList(rootEl, d); updatePreview(rootEl); };
    $('#cc-kw', host).oninput = function(){ c.keywordsText = this.value; saveData(); renderRuleList(rootEl, d); updatePreview(rootEl); };
    $('#cc-kw-case', host).onchange = function(){ c.filters.caseInsensitive = !!this.checked; saveData(); updatePreview(rootEl); };
    $('#cc-kw-word', host).onchange = function(){ c.filters.wholeWord = !!this.checked; saveData(); updatePreview(rootEl); };
    $('#cc-kw-var', host).onchange = function(){ c.filters.allowVariants = !!this.checked; saveData(); updatePreview(rootEl); };
    $('#cc-kw-neg', host).onchange = function(){ c.filters.skipNegated = !!this.checked; saveData(); updatePreview(rootEl); };

    // Wire window
    $('#cc-win-en', host).onchange = function(){ c.windowEnabled = !!this.checked; saveData(); renderRuleList(rootEl, d); updatePreview(rootEl); };
    $('#cc-win-min', host).oninput = function(){
      c.windowMin = clampInt(this.value, 0, 999999);
      if (c.windowUseMax && c.windowMax < c.windowMin) c.windowMax = c.windowMin;
      saveData();
      renderRuleList(rootEl, d);
      renderEditor(rootEl, d);
      updatePreview(rootEl);
    };
    $('#cc-win-useMax', host).onchange = function(){
      c.windowUseMax = !!this.checked;
      if (c.windowUseMax && c.windowMax < c.windowMin) c.windowMax = c.windowMin;
      saveData();
      renderRuleList(rootEl, d);
      renderEditor(rootEl, d);
      updatePreview(rootEl);
    };
    $('#cc-win-max', host).oninput = function(){
      c.windowMax = clampInt(this.value, 0, 999999);
      if (c.windowUseMax && c.windowMax < c.windowMin) c.windowMax = c.windowMin;
      saveData();
      renderRuleList(rootEl, d);
      renderEditor(rootEl, d);
      updatePreview(rootEl);
    };

    // Wire scoring
    $('#cc-score-en', host).onchange = function(){
      c.scoringEnabled = !!this.checked;
      saveData();
      renderRuleList(rootEl, d);
      renderEditor(rootEl, d);
      updatePreview(rootEl);
    };
    $('#cc-score-topic', host).onchange = function(){
      c.scoringTopicId = this.value || '';
      saveData();
      renderRuleList(rootEl, d);
      updatePreview(rootEl);
    };
  }

  function renderAll(rootEl, d){
    renderRuleList(rootEl, d);
    renderEditor(rootEl, d);
  }

  // ---------------------------
  // Toolbar ops
  // ---------------------------
  function addRule(d){
    var r = {
      id: uid('r'),
      enabled: true,
      name: 'Combined Rule',
      writeTargetId: 'character.personality',
      contextFieldText: '',
      conditions: {
        keywordsEnabled: true,
        keywordsText: '',
        filters: { caseInsensitive:true, wholeWord:true, allowVariants:true, skipNegated:true },

        windowEnabled: true,
        windowMin: 1,
        windowUseMax: false,
        windowMax: 1,

        scoringEnabled: false,
        scoringTopicId: ''
      }
    };
    normalizeRule(r);
    d.rules.unshift(r);
    d.ui.activeRuleId = r.id;
    saveData();
  }

  function dupRule(d){
    ensureActiveRule(d);
    var src = d.ui.activeRuleId ? getRuleById(d, d.ui.activeRuleId) : null;
    if (!src) return;
    var c = clone(src);
    c.id = uid('r');
    c.name = (c.name || 'Combined Rule') + ' (Copy)';
    normalizeRule(c);
    d.rules.unshift(c);
    d.ui.activeRuleId = c.id;
    saveData();
  }

  function delRule(d){
    ensureActiveRule(d);
    var id = d.ui.activeRuleId;
    if (!id) return;
    if (!confirm('Delete this combined rule?')) return;

    var idx = -1;
    for (var i=0;i<d.rules.length;i++){
      if (d.rules[i] && d.rules[i].id === id){ idx = i; break; }
    }
    if (idx < 0) return;
    d.rules.splice(idx, 1);
    ensureActiveRule(d);
    saveData();
  }

  // ---------------------------
  // DSL hooks
  // ---------------------------
  function getRuleSpecs(studioState){
    studioState = studioState || ensureStudioState();
    var d = (studioState.data && studioState.data[PANEL_ID]) ? studioState.data[PANEL_ID] : defaultData();
    if (d.enabled === false) return [];

    var out = [];
    for (var i=0;i<(d.rules||[]).length;i++){
      var r = d.rules[i];
      if (!r || r.enabled === false) continue;
      normalizeRule(r);

      var text = String(r.contextFieldText || '');
      if (!text) continue;

      var targetId = r.writeTargetId || 'character.personality';
      if (targetId !== 'character.personality' && targetId !== 'character.scenario') targetId = 'character.personality';

      var items = [];
      var c = r.conditions || {};

      // Condition 1: Keywords
      if (c.keywordsEnabled){
        var kw = splitKeywords(c.keywordsText);
        if (kw.length){
          items.push({
            type: 'keywords',
            sourceId: 'historyText.norm',
            keywords: kw,
            filters: {
              caseInsensitive: !!(c.filters && c.filters.caseInsensitive),
              wholeWord: !!(c.filters && c.filters.wholeWord),
              allowVariants: !!(c.filters && c.filters.allowVariants),
              skipNegated: !!(c.filters && c.filters.skipNegated)
            }
          });
        }
      }

      // Condition 2: Message count window
      if (c.windowEnabled){
        var minV = clampInt(c.windowMin, 0, 999999);
        var useMax = !!c.windowUseMax;
        var maxV = clampInt(c.windowMax, 0, 999999);
        if (useMax && maxV < minV) maxV = minV;

        items.push({
          type: 'messageCountWindow',
          sourceId: 'chat.messageCount',
          min: minV,
          useMax: useMax,
          max: useMax ? maxV : null
        });
      }

      // Condition 3: Scoring reference (require pass)
      if (c.scoringEnabled){
        var topicId = String(c.scoringTopicId || '');
        if (topicId){
          items.push({
            type: 'scoringRef',
            scoringTopicId: topicId,
            require: 'pass'
          });
        }
      }

      if (!items.length) continue;

      out.push({
        id: 'combined:rule:' + r.id,
        moduleId: PANEL_ID,
        enabled: true,
        label: 'Combined — ' + (r.name || 'Rule'),
        when: { op: 'and', items: items },
        write: { targetId: targetId, mode: 'append', text: text }
      });
    }

    return out;
  }

  function getWriteTargets(){
    return ['context.character.personality', 'context.character.scenario'];
  }

  // ---------------------------
  // Export (script preview block)
  // ---------------------------
  function getExportBlocks(studioState){
    var rules = getRuleSpecs(studioState);
    return [{
      kind: 'script',
      id: 'conditionCombiner.rules',
      code: emitExportScript(rules)
    }];
  }

  function emitExportScript(rules){
    // For now this is a deterministic “export block” for testing + engine wiring.
    // Engine will ultimately assemble all module exports into a single runnable script.
    var json = JSON.stringify(rules || [], null, 2);
    return ''
      + '/* === COMBINED RULES (Export) ========================================= */\n'
      + '/* DSL payload (Engine-owned at build time) */\n'
      + 'var CONDITION_COMBINER_RULES = ' + json + ';\n';
  }

  function updatePreview(rootEl){
    var ta = $('#cc-preview', rootEl);
    if (!ta) return;
    try{
      var blocks = getExportBlocks(root.StudioState) || [];
      ta.value = (blocks[0] && blocks[0].code) ? String(blocks[0].code) : '';
    }catch(_e){
      ta.value = '';
    }
  }

  // ---------------------------
  // Mount / Register
  // ---------------------------
  function mount(el){
    var d = loadData();
    ensureActiveRule(d);

    buildShell(el);
    renderAll(el, d);
    updatePreview(el);

    $('#cc-add', el).onclick = function(){ addRule(d); renderAll(el, d); updatePreview(el); };
    $('#cc-dup', el).onclick = function(){ dupRule(d); renderAll(el, d); updatePreview(el); };
    $('#cc-del', el).onclick = function(){ delRule(d); renderAll(el, d); updatePreview(el); };

    var copyBtn = $('#cc-copy', el);
    if (copyBtn) copyBtn.onclick = function(){
      var ta = $('#cc-preview', el);
      if (!ta) return;
      ta.focus();
      ta.select();
      try{ document.execCommand('copy'); }catch(_e){}
    };
  }

  var def = {
    id: PANEL_ID,
    mount: mount,
    getRuleSpecs: getRuleSpecs,
    getWriteTargets: getWriteTargets,
    getExportBlocks: getExportBlocks
  };

  if (root.Panels && typeof root.Panels.register === 'function'){
    root.Panels.register(def);
  } else {
    root.Panels = root.Panels || { register: function(d){ root.Panels[d.id] = d; } };
    root.Panels.register(def);
  }

})(window);

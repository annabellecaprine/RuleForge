(function (root) {
  'use strict';
  // Module registry for SBX Advanced (ES5).

  var SBX = (root.SBX = root.SBX || {});
  SBX.modules = SBX.modules || {};

  var MODULES = [
    { id: 'lorebook', label: 'Lorebook', groupId: 'lorebook', powerKey: 'lorebook' },
    { id: 'voices', label: 'Voices', groupId: 'voices', powerKey: 'voices' },
    { id: 'memory', label: 'Memory', groupId: 'memory', powerKey: 'memory' },
    { id: 'events', label: 'Events', groupId: 'events', powerKey: 'events' },
    { id: 'tone', label: 'Tone', groupId: 'tone', powerKey: 'tone' },
    { id: 'ambient', label: 'Ambient', groupId: 'ambient', powerKey: 'ambient' },
    { id: 'random', label: 'Random', groupId: 'random', powerKey: 'random' },
    { id: 'conditionCombiner', label: 'Cond Combiner', groupId: 'conditionCombiner', powerKey: 'conditionCombiner' },
    { id: 'scoring', label: 'Scoring', groupId: 'scoring', powerKey: 'scoring' }
  ];

  function list() { return MODULES.slice(); }
  function get(id) {
    id = String(id || '');
    for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i];
    return null;
  }

  function blockGroupId(block) {
    if (!block) return '';
    if (block.groupId) return String(block.groupId);

    var lbl = String(block.label || '');
    // legacy fallbacks (best-effort)
    if (lbl.indexOf('Scoring:') === 0) return 'scoring';
    if (lbl.indexOf('Ambient:') === 0) return 'ambient';
    if (lbl.indexOf('Random:') === 0) return 'random';
    if (lbl.indexOf('Event:') === 0) return 'events';
    if (lbl.indexOf('Memory:') === 0) return 'memory';
    if (lbl.indexOf('Lorebook:') === 0) return 'lorebook';
    if (lbl.indexOf('Voices:') === 0) return 'voices';
    if (lbl.indexOf('Tone:') === 0) return 'tone';
    if (lbl.indexOf('CC:') === 0) return 'conditionCombiner';
    return 'ungrouped';
  }

  SBX.modules.list = list;
  SBX.modules.get = get;
  SBX.modules.blockGroupId = blockGroupId;
})(window);

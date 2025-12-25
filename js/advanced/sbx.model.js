(function (root) {
  'use strict';

  var SBX = root.SBX = root.SBX || {};
  SBX.Model = SBX.Model || {};

  function isArr(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }

  function uid(prefix) {
    prefix = prefix || 'id';
    return prefix + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ---------------------------
  // Defaults
  // ---------------------------
  function defaultUi() {
    return {
      viewMode: 'editor',          // 'editor' | 'test'
      debugOpen: false,

      // Shell-level / subtab state
      activeSubtab: 'engine',      // 'engine' | 'test' | 'module:<id>'
      moduleTabsOpen: true
    };
  }

  function defaultImported() {
    return {
      pkg: null,
      blocks: [],
      selectedKey: null
    };
  }

  function defaultAppState() {
    return {
      lists: [],    // {id,label,description,items[]}
      derived: [],  // {key,description,listId,windowSize}
      blocks: []    // {id,type,label,description,join,groupId,conditions[],actions[]}
    };
  }

  function defaultData() {
    return {
      version: 1,
      ui: defaultUi(),
      imported: defaultImported(),
      appState: defaultAppState()
    };
  }

  // ---------------------------
  // Condition Nodes
  // ---------------------------
  function makeDefaultCondition() {
    // Leaf condition (nodeType: 'cond')
    return {
      nodeType: 'cond',
      not: false,
      type: 'countInHistory',   // canonical in new system
      listId: '',
      windowSize: 8,
      op: '>=',
      threshold: 1,

      // optional per-type fields:
      source: 'lastUserMsg',    // 'lastUserMsg' | 'normHistory'
      negationGuard: false,
      text: '',
      memKey: '',
      derivedKey: '',
      caseInsensitive: true
    };
  }

  function makeDefaultGroup() {
    return {
      nodeType: 'group',
      not: false,
      join: 'and',   // 'and' | 'or'
      items: []
    };
  }

  // ---------------------------
  // Actions
  // ---------------------------
  function makeDefaultAction() {
    return { type: 'appendPersonality', text: '' };
  }

  // ---------------------------
  // Blocks
  // ---------------------------
  function makeDefaultBlock(type) {
    type = type || 'if'; // 'if' | 'elseif' | 'else'
    return {
      id: uid('blk'),
      type: type,
      label: '',
      description: '',
      groupId: '',              // module grouping, etc.
      join: 'AND',              // AND/OR for top-level conditions
      conditions: (type === 'else') ? [] : [makeDefaultCondition()],
      actions: [makeDefaultAction()]
    };
  }

  // ---------------------------
  // Lists / Derived
  // ---------------------------
  function makeList(id, label) {
    return { id: id || uid('lst'), label: label || '', description: '', items: [] };
  }

  function makeDerived(key) {
    return { key: key || uid('derived'), description: '', listId: '', windowSize: 10 };
  }

  // ---------------------------
  // Normalize / Repair
  // ---------------------------
  function ensureDataShape(d) {
    if (!d || typeof d !== 'object') d = defaultData();

    if (!d.ui) d.ui = defaultUi();
    if (!d.imported) d.imported = defaultImported();
    if (!d.appState) d.appState = defaultAppState();

    if (!isArr(d.appState.lists)) d.appState.lists = [];
    if (!isArr(d.appState.derived)) d.appState.derived = [];
    if (!isArr(d.appState.blocks)) d.appState.blocks = [];

    // Normalize block nodes
    for (var i = 0; i < d.appState.blocks.length; i++) {
      var b = d.appState.blocks[i] || {};
      if (!b.id) b.id = uid('blk');
      if (!b.type) b.type = 'if';
      if (!b.join) b.join = 'AND';
      if (!isArr(b.conditions)) b.conditions = (b.type === 'else') ? [] : [makeDefaultCondition()];
      if (!isArr(b.actions)) b.actions = [makeDefaultAction()];
    }

    return d;
  }

  // Public API
  SBX.Model.uid = uid;
  SBX.Model.clone = clone;

  SBX.Model.defaultData = defaultData;
  SBX.Model.ensureDataShape = ensureDataShape;

  SBX.Model.makeList = makeList;
  SBX.Model.makeDerived = makeDerived;
  SBX.Model.makeDefaultCondition = makeDefaultCondition;
  SBX.Model.makeDefaultGroup = makeDefaultGroup;
  SBX.Model.makeDefaultAction = makeDefaultAction;
  SBX.Model.makeDefaultBlock = makeDefaultBlock;

})(window);

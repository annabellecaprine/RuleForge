(function (root) {
  'use strict';

  // ---- GATE ----
  if (!root.__RUN_SMOKE_TEST__) return;

  // ---- DEP CHECK (prints exactly what's missing) ----
  var deps = {
    Sources: !!root.Sources,
    Reasons: !!root.Reasons,
    EvalCore: !!root.EvalCore,
    DSL: !!root.DSL,
    DSLValidate: !!root.DSLValidate,
    Sim: !!root.Sim
  };
  if (root.console && console.log) console.log('[SmokeTest deps]', deps);

  if (!deps.Sources || !deps.Reasons || !deps.EvalCore || !deps.DSL || !deps.DSLValidate || !deps.Sim) {
    if (root.console && console.error) console.error('[SmokeTest] Missing deps. Fix script src paths/names.');
    return;
  }

  // ---- SETUP SIM CONTEXT ----
  root.Sim.reset();
  root.Sim.setPersonaName('Alex');
  root.Sim.setCharacter({
    chat_name: 'Mira',
    scenario: 'Cafe AU',
    personality: 'Warm and teasing.'
  });
  root.Sim.setMessages([
    'Hi there.',
    'I really want strawberry cake.'
  ]);

  // ---- DSL RULES ----
  var ruleSpecs = [
    {
      id: 'comb_strawberry_cake',
      label: 'Strawberry + Cake combo',
      moduleId: 'conditionCombiner',
      priority: 50,
      targets: ['inject.pre'],
      when: { type: 'allTerms', source: 'lastUser.norm', terms: ['strawberry', 'cake'], mode: 'word' },
      effects: { 'inject.pre': ['User mentioned strawberry cake.'] }
    },
    {
      id: 'ambient_cafe',
      label: 'Cafe ambient flavor',
      moduleId: 'ambient',
      priority: 10,
      targets: ['inject.pre'],
      when: { type: 'termHit', source: 'scenario.norm', term: 'cafe', mode: 'word' },
      effects: { 'inject.pre': ['Ambient: soft cafe noise in the background.'] }
    }
  ];

  // ---- VALIDATE ----
  var diag = root.DSLValidate.validateRules(ruleSpecs);
  console.log('[SmokeTest] DSL Validation:', diag);

  if (diag.errors && diag.errors.length) {
    console.warn('[SmokeTest] Validation errors (stopping):', diag.errors);
    return;
  }

  // ---- COMPILE + RUN ----
  var rules = root.DSL.compileRules(ruleSpecs);
  var report = root.EvalCore.runRules(rules, {
    ctx: root.Sim.getCtx(),
    state: {},
    derived: {},
    trace: []
  });

  // ---- PRINT REPORT ----
  root.EvalCore.print(report, { showTrace: true });

})(window);

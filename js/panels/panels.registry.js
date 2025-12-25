(function (root) {
  'use strict';

  // Global namespace for all panels
  var Panels = root.Panels || (root.Panels = {});

  Panels._list = Panels._list || [];   // ordered registration (optional)

  Panels.register = function (panelDef) {
    if (!panelDef || !panelDef.id) throw new Error('Panels.register requires {id}');

    // Canonical storage: direct lookup by id
    Panels[panelDef.id] = panelDef;

    // Optional: ordered registration list
    Panels._list.push(panelDef.id);
  };

})(window);

(function (root) {
  'use strict';
  // SBX internal namespace (no build step, ES5)
  // All advanced library modules attach to root.SBX.*
  if (!root) { throw new Error('SBX requires a global root (window).'); }

  var SBX = root.SBX || {};
  SBX.version = SBX.version || '0.1.0';

  SBX.util = SBX.util || {};
  SBX.store = SBX.store || {};
  SBX.model = SBX.model || {};
  SBX.compile = SBX.compile || {};
  SBX.codegen = SBX.codegen || {};
  SBX.harness = SBX.harness || {};
  SBX.ui = SBX.ui || {};

  root.SBX = SBX;
})(window);

(function (root) {
  'use strict';
  // CSS injection helpers (ES5). Depends on sbx.ns.js.
  var SBX = (root.SBX = root.SBX || {});
  SBX.css = SBX.css || {};

  function injectOnce(id, cssText) {
    if (!id) return;
    if (document.getElementById(id)) return;
    var style = document.createElement('style');
    style.id = id;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(String(cssText || '')));
    document.head.appendChild(style);
  }

  // Wrap CSS rules under a scope selector to prevent bleeding.
  // Example: scoped('.sbx-panel', '.a{...}.b{...}') => '.sbx-panel .a{...} ...'
  function scoped(scopeSel, rawCss) {
    scopeSel = String(scopeSel || '').trim();
    rawCss = String(rawCss || '');
    if (!scopeSel) return rawCss;

    function scopeBlock(css) {
      var out = '';
      var i = 0;

      while (i < css.length) {
        // @media / @supports blocks
        if (css.substr(i, 6) === '@media' || css.substr(i, 9) === '@supports') {
          var brace = css.indexOf('{', i);
          if (brace === -1) { out += css.substr(i); break; }
          var header = css.substring(i, brace + 1);

          // Find matching closing brace
          var depth = 1, j = brace + 1;
          while (j < css.length && depth > 0) {
            var ch = css.charAt(j);
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            j++;
          }
          var inner = css.substring(brace + 1, j - 1);
          out += header + scopeBlock(inner) + '}';
          i = j;
          continue;
        }

        // Normal rule: selectors { body }
        var selEnd = css.indexOf('{', i);
        if (selEnd === -1) { out += css.substr(i); break; }
        var sel = css.substring(i, selEnd).trim();

        var bodyEnd = css.indexOf('}', selEnd);
        if (bodyEnd === -1) { out += css.substr(i); break; }
        var body = css.substring(selEnd, bodyEnd + 1);

        // Skip keyframes/font-face blocks
        if (sel.indexOf('@keyframes') === 0 || sel.indexOf('@font-face') === 0) {
          out += sel + body;
          i = bodyEnd + 1;
          continue;
        }

        // Prefix each selector group (split by ",") if it isn't already scoped.
        var parts = sel.split(',');
        for (var p = 0; p < parts.length; p++) {
          var s = parts[p].trim();
          if (!s) continue;
          if (s.indexOf(scopeSel) === 0) parts[p] = s;
          else parts[p] = scopeSel + ' ' + s;
        }
        out += parts.join(', ') + body;
        i = bodyEnd + 1;
      }

      return out;
    }

    return scopeBlock(rawCss);
  }

  SBX.css.injectOnce = injectOnce;
  SBX.css.scoped = scoped;
})(window);

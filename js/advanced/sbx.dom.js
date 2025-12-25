(function (root) {
  'use strict';
  // DOM helpers (ES5). Depends on sbx.ns.js (SBX namespace).
  var SBX = (root.SBX = root.SBX || {});
  SBX.dom = SBX.dom || {};

  function q(sel, scope) { return (scope || document).querySelector(sel); }
  function qa(sel, scope) { return (scope || document).querySelectorAll(sel); }

  function on(el, evt, fn, opts) {
    if (!el) return;
    if (el.addEventListener) el.addEventListener(evt, fn, !!opts);
    else if (el.attachEvent) el.attachEvent('on' + evt, fn);
  }

  function off(el, evt, fn, opts) {
    if (!el) return;
    if (el.removeEventListener) el.removeEventListener(evt, fn, !!opts);
    else if (el.detachEvent) el.detachEvent('on' + evt, fn);
  }

  function matches(el, sel) {
    if (!el || el.nodeType !== 1) return false;
    var p = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
    if (p) return p.call(el, sel);
    // tiny fallback
    var nodes = (el.parentNode || document).querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) if (nodes[i] === el) return true;
    return false;
  }

  function closest(el, sel, stopEl) {
    while (el && el !== stopEl && el.nodeType === 1) {
      if (matches(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  // Event delegation: SBX.dom.delegate(root, 'click', '.btn', fn)
  function delegate(rootEl, evt, sel, fn) {
    on(rootEl, evt, function (e) {
      e = e || root.event;
      var target = e.target || e.srcElement;
      var hit = closest(target, sel, rootEl);
      if (hit) fn.call(hit, e, hit);
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === 'className') node.className = attrs[k];
      else if (k === 'text') node.appendChild(document.createTextNode(String(attrs[k])));
      else if (k === 'html') node.innerHTML = String(attrs[k]);
      else node.setAttribute(k, String(attrs[k]));
    }
    if (children && children.length) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null) continue;
        if (typeof c === 'string') node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      }
    }
    return node;
  }

  function empty(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function text(node, s) { empty(node); node.appendChild(document.createTextNode(String(s == null ? '' : s))); }

  SBX.dom.q = q;
  SBX.dom.qa = qa;
  SBX.dom.on = on;
  SBX.dom.off = off;
  SBX.dom.matches = matches;
  SBX.dom.closest = closest;
  SBX.dom.delegate = delegate;
  SBX.dom.el = el;
  SBX.dom.empty = empty;
  SBX.dom.text = text;
})(window);

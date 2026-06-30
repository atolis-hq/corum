(function () {
  'use strict';

  var KNOWN_PATHS = new Set(['/dashboard', '/components', '/node', '/graph']);

  function parseRoute(hash) {
    var raw = (hash || '').replace(/^#/, '') || '/dashboard';
    var qIndex = raw.indexOf('?');
    var pathPart = qIndex === -1 ? raw : raw.slice(0, qIndex);
    var search = qIndex === -1 ? '' : raw.slice(qIndex + 1);
    var params = new URLSearchParams(search);
    var segments = pathPart.split('/').filter(Boolean);

    if (segments.length === 0) {
      return { branch: null, pathname: '/dashboard', params: params };
    }

    var firstDecoded = decodeURIComponent(segments[0]);
    var firstAsPath = '/' + firstDecoded;

    if (KNOWN_PATHS.has(firstAsPath)) {
      return { branch: null, pathname: firstAsPath, params: params };
    }

    var branch = firstDecoded;
    var pathname = segments[1] ? '/' + decodeURIComponent(segments[1]) : '/dashboard';
    return { branch: branch, pathname: pathname, params: params };
  }

  function buildRoute(opts) {
    var pathname = opts.pathname;
    var params = opts.params || {};
    var branch = opts.branch || null;
    var qs = new URLSearchParams(params).toString();
    var suffix = qs ? '?' + qs : '';
    if (!branch) {
      return '#' + pathname + suffix;
    }
    var encodedBranch = encodeURIComponent(branch);
    return '#/' + encodedBranch + pathname + suffix;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseRoute: parseRoute, buildRoute: buildRoute };
  }
  if (typeof window !== 'undefined') {
    window.CorumRouter = { parseRoute: parseRoute, buildRoute: buildRoute };
  }
}());

(function () {
  'use strict';

  var KNOWN_PATHS = new Set(['/dashboard', '/namespaces', '/namespace', '/node']);

  function parseRoute(hash) {
    var raw = (hash || '').replace(/^#/, '') || '/dashboard';
    var qIndex = raw.indexOf('?');
    var pathPart = qIndex === -1 ? raw : raw.slice(0, qIndex);
    var search = qIndex === -1 ? '' : raw.slice(qIndex + 1);
    var params = new URLSearchParams(search);
    var segments = pathPart.split('/').filter(Boolean);

    if (segments.length === 0) {
      return { branch: null, pathname: '/dashboard', params: params, plugin: null };
    }

    var decoded = segments.map(decodeURIComponent);

    // 'p' is a reserved first segment for plugin routes: /p/<id>/<page>.
    if (decoded[0] === 'p') {
      return pluginRoute(null, decoded, params);
    }

    var firstAsPath = '/' + decoded[0];
    if (KNOWN_PATHS.has(firstAsPath)) {
      return { branch: null, pathname: firstAsPath, params: params, plugin: null };
    }

    var branch = decoded[0];
    if (decoded[1] === 'p') {
      return pluginRoute(branch, decoded.slice(1), params);
    }
    var pathname = decoded[1] ? '/' + decoded[1] : '/dashboard';
    return { branch: branch, pathname: pathname, params: params, plugin: null };
  }

  function pluginRoute(branch, parts, params) {
    // parts: ['p', id, page?]
    var id = parts[1] || '';
    var page = parts[2] || null;
    var pathname = '/p/' + id + (page ? '/' + page : '');
    return { branch: branch, pathname: pathname, params: params, plugin: { id: id, page: page } };
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

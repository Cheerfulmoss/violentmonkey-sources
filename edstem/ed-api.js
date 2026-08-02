// ed-api.js
//
// Reusable Ed Discussion (edstem.org) API client for userscripts.
// Exposes a single global: window.EdStemAPI
//
// Usage from a ViolentMonkey/Tampermonkey userscript:
//
//   // @require https://cdn.jsdelivr.net/gh/<you>/<repo>@<tag>/ed-api.js
//
// then in your script:
//
//   const { EdAPI, getCurrentThread, flattenComments, extractPlainText, xmlDocument } = window.EdStemAPI;
//
// Pin to a tag (not a branch) once this stabilises — jsdelivr caches by
// tag/commit, so @require against `main` may serve a stale cached copy
// after you push updates, or unexpectedly change under you.

(function (global) {
  'use strict';

  /* ============================================================ *
   * AUTH
   * ============================================================ */

  function findToken() {
    // Confirmed key pattern from Ed's own frontend: region-scoped token
    // with a fallback to an unscoped key.
    const region = localStorage.getItem('authRegion') || 'au';
    const direct = localStorage.getItem(`authToken:${region}`) || localStorage.getItem('authToken');
    if (direct) return direct;

    // Fallback in case the key naming ever changes: scan for anything
    // JWT-shaped instead of failing outright.
    const jwtLike = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const value = store.getItem(store.key(i));
        if (value && jwtLike.test(value)) return value;
        if (value?.startsWith('{')) {
          try {
            const obj = JSON.parse(value);
            for (const v of Object.values(obj)) {
              if (typeof v === 'string' && jwtLike.test(v)) return v;
            }
          } catch { /* not JSON, skip */ }
        }
      }
    }
    return null;
  }

  /* ============================================================ *
   * API CLIENT
   * ============================================================ */

  class EdAPI {
    static findToken() {
      return findToken();
    }

    static async fetch(path, { method = 'GET', body = null } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      const token = findToken();
      if (token) headers['X-Token'] = token;

      const response = await fetch(`https://${location.host}${path}`, {
        method,
        credentials: 'include',
        headers,
        body: body ? JSON.stringify(body) : null,
      });

      if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`);
      return response.json();
    }

    static currentUser() {
      return this.fetch('/api/user').then((d) => d.user);
    }

    static async thread(threadId) {
      const data = await this.fetch(`/api/threads/${threadId}`);
      // `users` comes back as a sibling of `thread` in the response, not
      // nested inside it — merge it in so callers can just read
      // thread.users.
      return { ...data.thread, users: data.users };
    }

    static postComment(threadId, content) {
      return this.fetch(`/api/threads/${threadId}/comments`, {
        method: 'POST',
        body: { comment: { type: 'comment', content, is_private: false, is_anonymous: false } },
      });
    }

    static editComment(commentId, content) {
      return this.fetch(`/api/comments/${commentId}`, {
        method: 'PUT',
        body: { comment: { content, is_private: false, is_anonymous: false } },
      });
    }
  }

  /* ============================================================ *
   * URL / DOM HELPERS
   * ============================================================ */

  function getCurrentThread() {
    const match = location.pathname.match(/courses\/(\d+)\/discussion\/(\d+)/);
    if (!match) return null;
    return { courseId: Number(match[1]), threadId: Number(match[2]) };
  }

  // Ed's comment tree is genuinely nested (replies-to-replies), not flat.
  function flattenComments(comments) {
    const out = [];
    for (const c of comments || []) {
      out.push(c);
      if (c.comments?.length) out.push(...flattenComments(c.comments));
    }
    return out;
  }

  function extractPlainText(comment) {
    const html = comment.document ?? comment.content ?? '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent.trim();
  }

  const escapeHtml = (text) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  // Wrapping payloads in a <snippet> code block is what's been confirmed
  // (via captured network traffic) to round-trip byte-for-byte clean
  // through Ed's renderer — plain <paragraph>/<pre> content can get
  // reformatted (link auto-detection, whitespace collapsing, etc).
  function xmlDocument(text) {
    return `<document version="2.0"><snippet language="txt" runnable="false" line-numbers="true"><snippet-file id="code">${escapeHtml(text)}</snippet-file></snippet></document>`;
  }

  /* ============================================================ *
   * PASSIVE NETWORK LISTENER
   *
   * Patches window.fetch and XMLHttpRequest to observe responses to
   * /api/threads/<id> requests that were going to happen anyway (Ed's own
   * page, or your own polling) — lets a consumer react immediately
   * instead of only on its own timer, with zero extra requests.
   * ============================================================ */

  function installThreadListener(onThreadPayload) {
    function threadIdFromUrl(url) {
      const match = String(url).match(/\/api\/threads\/(\d+)/);
      return match ? Number(match[1]) : null;
    }

    function handle(threadId, json) {
      if (!json?.thread) return;
      onThreadPayload(threadId, { ...json.thread, users: json.users });
    }

    const nativeFetch = global.fetch;
    global.fetch = async function (...args) {
      const response = await nativeFetch.apply(this, args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      const threadId = threadIdFromUrl(url);
      if (threadId) {
        response.clone().json().then((json) => handle(threadId, json)).catch(() => {});
      }
      return response;
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.addEventListener('load', () => {
        const threadId = threadIdFromUrl(url);
        if (!threadId) return;
        try {
          handle(threadId, JSON.parse(this.responseText));
        } catch { /* not JSON, ignore */ }
      });
      return nativeOpen.call(this, method, url, ...rest);
    };
  }

  /* ============================================================ *
   * EXPORT
   * ============================================================ */

  global.EdStemAPI = {
    EdAPI,
    getCurrentThread,
    flattenComments,
    extractPlainText,
    xmlDocument,
    installThreadListener,
  };
})(window);

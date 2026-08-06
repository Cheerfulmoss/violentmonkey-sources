// ed-api.js
//
// Reusable Ed Discussion (edstem.org) API client for userscripts.
// Exposes a single global: window.EdStemAPI
//
// Usage from a ViolentMonkey/Tampermonkey userscript:
//
//   // @require <link to raw github>
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

  /**
   * Locate the current user's Ed auth token in browser storage.
   *
   * Primary path: Ed's frontend stores a region-scoped token
   * (`authToken:<region>`), falling back to an unscoped `authToken` key.
   *
   * Fallback path: if neither key is present (e.g. Ed changes its
   * storage scheme), scan localStorage/sessionStorage for anything
   * JWT-shaped rather than failing outright.
   *
   * @returns {string|null}
   */
  function findToken() {
    const region = localStorage.getItem('authRegion') || 'au';
    const direct = localStorage.getItem(`authToken:${region}`) || localStorage.getItem('authToken');
    if (direct) return direct;

    const jwtLike = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const value = store.getItem(store.key(i));
        if (!value) continue;

        if (jwtLike.test(value)) return value;

        if (value.startsWith('{')) {
          try {
            const obj = JSON.parse(value);
            for (const v of Object.values(obj)) {
              if (typeof v === 'string' && jwtLike.test(v)) return v;
            }
          } catch {
            /* not JSON, skip */
          }
        }
      }
    }

    return null;
  }

  /* ============================================================ *
   * API CLIENT
   * ============================================================ */

  class EdAPI {
    static cache = {
      user: null,
      courses: null,
    };

    /** Exposed for callers that just want the raw token (e.g. for MCP-style tools). */
    static findToken() {
      return findToken();
    }

    /**
     * Low-level request helper. Adds the auth token (if found) and
     * throws an Error (with `.status` and `.data`) on non-2xx responses.
     *
     * @param {string} path - API path, e.g. "/api/threads/123"
     * @param {object} [opts]
     * @param {string} [opts.method="GET"]
     * @param {object|null} [opts.body]
     * @param {object} [opts.headers]
     */
    static async request(path, { method = 'GET', body = null, headers = {} } = {}) {
      const token = findToken();

      const response = await fetch(`https://${location.host}${path}`, {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Token': token } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : null,
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        /* empty body */
      }

      if (!response.ok) {
        const error = new Error(`${method} ${path} failed (${response.status})`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    }

    /** Current logged-in user. Cached; pass `{ refresh: true }` to bypass. */
    static async user({ refresh = false } = {}) {
      if (this.cache.user && !refresh) return this.cache.user;

      const data = await this.request('/api/user');
      this.cache.user = data.user;
      return this.cache.user;
    }

    /** Courses the current user is enrolled in. Cached; pass `{ refresh: true }` to bypass. */
    static async courses({ refresh = false } = {}) {
      if (this.cache.courses && !refresh) return this.cache.courses;

      const data = await this.request('/api/user');
      this.cache.courses = data.courses.map((x) => x.course);
      return this.cache.courses;
    }

    /** Patch a user record (e.g. `{ name: "..." }`). Invalidates the user cache. */
    static async updateUser(id, patch) {
      const data = await this.request(`/api/users/${id}`, {
        method: 'PATCH',
        body: { user: patch },
      });

      this.cache.user = null;
      return data;
    }

    /**
     * Find a user by id, searching a specific course or (if omitted)
     * every course the current user belongs to.
     */
    static async lookupUser(id, { course = null } = {}) {
      const courses = course ? [course] : await this.courses();

      for (const current of courses) {
        const user = await this.lookupUserInCourse(current, id);
        if (user) return user;
      }

      return null;
    }

    /**
     * Look up a single user within one course. Tries the endpoint that
     * includes emails first (requires staff permissions), then falls
     * back to the plain endpoint. Returns null (rather than throwing)
     * on 403/404 so callers can treat "not found here" as a normal case.
     */
    static async lookupUserInCourse(course, id) {
      const endpoints = [
        `/api/courses/${course.id}/users/${id}?emails=true`,
        `/api/courses/${course.id}/users/${id}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const data = await this.request(endpoint);
          if (data.user) return { course, ...data.user };
        } catch (error) {
          if (error.status === 403 || error.status === 404) continue;
          throw error;
        }
      }

      return null;
    }

    /** All users (with roles) on a course's admin roster. */
    static async courseUsers(courseId) {
      const data = await this.request(`/api/courses/${courseId}/admin`);
      return data.users || [];
    }

    /** A thread, including its `users` lookup map. */
    static async thread(id) {
      const data = await this.request(`/api/threads/${id}`);
      return { ...data.thread, users: data.users };
    }

    /** Post a new top-level comment/answer on a thread. */
    static async createComment(threadId, content) {
      return this.request(`/api/threads/${threadId}/comments`, {
        method: 'POST',
        body: {
          comment: { type: 'comment', content, is_private: false, is_anonymous: false },
        },
      });
    }

    /** Edit an existing comment's content. */
    static async editComment(id, content) {
      return this.request(`/api/comments/${id}`, {
        method: 'PUT',
        body: {
          comment: { content, is_private: false, is_anonymous: false },
        },
      });
    }

    /** Clear the user/courses cache (e.g. after switching accounts). */
    static clearCache() {
      this.cache.user = null;
      this.cache.courses = null;
    }
  }

  /* ============================================================ *
   * URL / DOM HELPERS
   * ============================================================ */

  /** Parse `{ courseId, threadId }` out of the current Ed discussion URL, or null. */
  function getCurrentThread() {
    const match = location.pathname.match(/courses\/(\d+)\/discussion\/(\d+)/);
    if (!match) return null;

    return {
      courseId: Number(match[1]),
      threadId: Number(match[2]),
    };
  }

  /**
   * Flatten Ed's nested comment tree (replies-to-replies) into a single
   * array, in depth-first order.
   */
  function flattenComments(comments) {
    const out = [];

    for (const c of comments || []) {
      out.push(c);
      if (c.comments?.length) {
        out.push(...flattenComments(c.comments));
      }
    }

    return out;
  }

  /** Strip a comment's HTML content down to plain text. */
  function extractPlainText(comment) {
    const html = comment.document ?? comment.content ?? '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent.trim();
  }

  const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  /**
   * Wrap plain text as an Ed "document" containing a single code
   * snippet block. Confirmed (via captured network traffic) to
   * round-trip byte-for-byte through Ed's renderer — plain
   * <paragraph>/<pre> content can get reformatted (link
   * auto-detection, whitespace collapsing, etc).
   */
  function xmlDocument(text) {
    return `<document version="2.0"><snippet language="txt" runnable="false" line-numbers="true"><snippet-file id="code">${escapeHtml(
      text
    )}</snippet-file></snippet></document>`;
  }

  /* ============================================================ *
   * PASSIVE NETWORK LISTENER
   *
   * Patches window.fetch and XMLHttpRequest to observe responses to
   * /api/threads/<id> requests that were going to happen anyway (Ed's own
   * page, or your own polling) — lets a consumer react immediately
   * instead of only on its own timer, with zero extra requests.
   * ============================================================ */

  /**
   * @param {(threadId: number, thread: object) => void} onThreadPayload
   * @returns {() => void} an `uninstall` function that restores the
   *   original fetch/XHR implementations. Calling `installThreadListener`
   *   more than once without uninstalling will stack patches, so keep
   *   the returned handle around if you might install more than once
   *   (e.g. across userscript re-injections).
   */
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
        response
          .clone()
          .json()
          .then((json) => handle(threadId, json))
          .catch(() => {});
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
        } catch {
          /* not JSON, ignore */
        }
      });

      return nativeOpen.call(this, method, url, ...rest);
    };

    return function uninstall() {
      global.fetch = nativeFetch;
      XMLHttpRequest.prototype.open = nativeOpen;
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

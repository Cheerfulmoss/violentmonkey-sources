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
   * CACHE
   * ============================================================ */

  let courseCache = null;


  /* ============================================================ *
   * AUTH
   * ============================================================ */

  function findToken() {
    // Confirmed key pattern from Ed's own frontend: region-scoped token
    // with a fallback to an unscoped key.

    const region =
      localStorage.getItem('authRegion') || 'au';


    const direct =
      localStorage.getItem(`authToken:${region}`) ||
      localStorage.getItem('authToken');


    if (direct) {
      return direct;
    }


    // Fallback in case the key naming ever changes: scan for anything
    // JWT-shaped instead of failing outright.

    const jwtLike =
      /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;


    for (const store of [
      localStorage,
      sessionStorage
    ]) {

      for (let i = 0; i < store.length; i++) {

        const value =
          store.getItem(
            store.key(i)
          );


        if (
          value &&
          jwtLike.test(value)
        ) {
          return value;
        }


        if (
          value?.startsWith('{')
        ) {

          try {

            const obj =
              JSON.parse(value);


            for (
              const v of Object.values(obj)
            ) {

              if (
                typeof v === 'string' &&
                jwtLike.test(v)
              ) {
                return v;
              }
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
   * NEXTGEN API CLIENT
   * ============================================================ */

  class EdAPI_NEXTGEN {

    static cache = {
      user: null,
      courses: null
    };

    static findToken() {
        return findToken();
    }

    static async request(
      path,
      {
        method = "GET",
        body = null,
        headers = {}
      } = {}
    ) {

      const token =
        findToken();


      const response =
        await fetch(
          `https://${location.host}${path}`,
          {
            method,

            credentials: "include",

            headers: {
              "Content-Type": "application/json",

              ...(token
                ? {
                    "X-Token": token
                  }
                : {}),

              ...headers
            },

            body:
              body
                ? JSON.stringify(body)
                : null
          }
        );


      let data = null;

      try {
        data =
          await response.json();

      } catch {
        /* empty body */
      }


      if (!response.ok) {

        const error =
          new Error(
            `${method} ${path} failed (${response.status})`
          );


        error.status =
          response.status;


        error.data =
          data;


        throw error;
      }


      return data;
    }



    static async user({
      refresh = false
    } = {}) {

      if (
        this.cache.user &&
        !refresh
      ) {
        return this.cache.user;
      }


      const data =
        await this.request(
          "/api/user"
        );


      this.cache.user =
        data.user;


      return this.cache.user;
    }



    static async courses({
      refresh = false
    } = {}) {

      if (
        this.cache.courses &&
        !refresh
      ) {
        return this.cache.courses;
      }


      const data =
        await this.request(
          "/api/user"
        );


      this.cache.courses =
        data.courses.map(
          x => x.course
        );


      return this.cache.courses;
    }



    static async updateUser(
      id,
      patch
    ) {

      const data =
        await this.request(
          `/api/users/${id}`,
          {
            method: "PATCH",

            body: {
              user: patch
            }
          }
        );


      this.cache.user =
        null;


      return data;
    }



    static async lookupUser(
      id,
      {
        course = null
      } = {}
    ) {

      const courses =
        course
          ? [course]
          : await this.courses();


      for (
        const current of courses
      ) {

        const user =
          await this.lookupUserInCourse(
            current,
            id
          );


        if (user) {
          return user;
        }
      }


      return null;
    }



    static async lookupUserInCourse(
      course,
      id
    ) {

      for (
        const endpoint of [
          `/api/courses/${course.id}/users/${id}?emails=true`,
          `/api/courses/${course.id}/users/${id}`
        ]
      ) {

        try {

          const data =
            await this.request(
              endpoint
            );


          if (
            data.user
          ) {

            return {
              course,

              ...data.user
            };
          }

        } catch(error) {

          if (
            error.status === 403
          ) {
            continue;
          }

          if (
            error.status === 404
          ) {
            continue;
          }


          throw error;
        }
      }


      return null;
    }

    static async courseUsers(courseId) {

        const data =
            await this.request(
                `/api/courses/${courseId}/admin`
            );

        return data.users || [];
    }

    static async thread(
      id
    ) {

      const data =
        await this.request(
          `/api/threads/${id}`
        );


      return {
        ...data.thread,

        users:
          data.users
      };
    }



    static async createComment(
      threadId,
      content
    ) {

      return this.request(
        `/api/threads/${threadId}/comments`,
        {
          method: "POST",

          body: {
            comment: {
              type: "comment",
              content,
              is_private: false,
              is_anonymous: false
            }
          }
        }
      );
    }



    static async editComment(
      id,
      content
    ) {

      return this.request(
        `/api/comments/${id}`,
        {
          method: "PUT",

          body: {
            comment: {
              content,
              is_private: false,
              is_anonymous: false
            }
          }
        }
      );
    }



    static clearCache() {

      this.cache.user =
        null;


      this.cache.courses =
        null;
    }

  }

  /* ============================================================ *
   * URL / DOM HELPERS
   * ============================================================ */

  function getCurrentThread() {

    const match =
      location.pathname.match(
        /courses\/(\d+)\/discussion\/(\d+)/
      );


    if (!match) {
      return null;
    }


    return {
      courseId: Number(match[1]),
      threadId: Number(match[2])
    };
  }



  // Ed's comment tree is genuinely nested (replies-to-replies), not flat.

  function flattenComments(comments) {

    const out = [];


    for (
      const c of comments || []
    ) {

      out.push(c);


      if (
        c.comments?.length
      ) {

        out.push(
          ...flattenComments(
            c.comments
          )
        );
      }
    }


    return out;
  }



  function extractPlainText(comment) {

    const html =
      comment.document ??
      comment.content ??
      '';


    const div =
      document.createElement(
        'div'
      );


    div.innerHTML =
      html;


    return div.textContent.trim();
  }



  const escapeHtml =
    (text) =>
      text
        .replaceAll(
          '&',
          '&amp;'
        )
        .replaceAll(
          '<',
          '&lt;'
        )
        .replaceAll(
          '>',
          '&gt;'
        );



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

  function installThreadListener(
    onThreadPayload
  ) {


    function threadIdFromUrl(url) {

      const match =
        String(url).match(
          /\/api\/threads\/(\d+)/
        );


      return match
        ? Number(match[1])
        : null;
    }



    function handle(
      threadId,
      json
    ) {

      if (
        !json?.thread
      ) {
        return;
      }


      onThreadPayload(
        threadId,
        {
          ...json.thread,
          users: json.users
        }
      );
    }



    const nativeFetch =
      global.fetch;



    global.fetch =
      async function (...args) {

        const response =
          await nativeFetch.apply(
            this,
            args
          );


        const url =
          typeof args[0] === 'string'
            ? args[0]
            : args[0]?.url;


        const threadId =
          threadIdFromUrl(
            url
          );


        if (threadId) {

          response
            .clone()
            .json()
            .then(
              (json) =>
                handle(
                  threadId,
                  json
                )
            )
            .catch(
              () => {}
            );
        }


        return response;
      };



    const nativeOpen =
      XMLHttpRequest.prototype.open;



    XMLHttpRequest.prototype.open =
      function (
        method,
        url,
        ...rest
      ) {

        this.addEventListener(
          'load',
          () => {

            const threadId =
              threadIdFromUrl(
                url
              );


            if (!threadId) {
              return;
            }


            try {

              handle(
                threadId,
                JSON.parse(
                  this.responseText
                )
              );

            } catch {
              /* not JSON, ignore */
            }
          }
        );


        return nativeOpen.call(
          this,
          method,
          url,
          ...rest
        );
      };
  }



  /* ============================================================ *
   * EXPORT
   * ============================================================ */

   global.EdStemAPI = {
     EdAPI_NEXTGEN,

     getCurrentThread,
     flattenComments,
     extractPlainText,
     xmlDocument,
     installThreadListener,
   };


})(window);

/**
 * PersistentMap
 *
 * A Map-like structure backed by localStorage, kept consistent across
 * multiple tabs/instances of the same origin.
 *
 * - Writes (`set`, `delete`, `clear`) are serialized across all tabs via the
 *   Web Locks API, so every write operates on the freshest possible data
 *   straight from storage. No merge-of-stale-snapshots needed for writes.
 * - Other tabs' writes are picked up via the `storage` event and mirrored
 *   into the in-memory copy used for synchronous reads.
 * - Optional polling (`pollMs`) re-reads storage under a shared lock on an
 *   interval, as a safety net for same-tab multi-instance use (the
 *   `storage` event never fires for writes from the same document) and for
 *   backgrounded tabs where `storage` event delivery can be delayed.
 * - Per-field merge behavior (overwrite vs combine vs custom) is
 *   configurable via `fieldMerge()`.
 *
 * Requires the Web Locks API for cross-tab write atomicity; falls back to
 * best-effort (no cross-tab guarantee) in browsers without it.
 */

// Build a merge function with per-field strategies.
// strategies: { fieldName: "overwrite" | "combine" | (oldVal, newVal) => merged }
// Fields not listed default to "overwrite" (latest write wins).
function fieldMerge(strategies = {}) {
    const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);

    return (oldValue, newValue) => {
        if (!isPlain(oldValue) || !isPlain(newValue)) return newValue;

        // default: shallow spread, new value wins per field
        const result = { ...oldValue, ...newValue };

        for (const [field, strategy] of Object.entries(strategies)) {
            if (!(field in newValue)) continue; // nothing new for this field, leave as-is

            const oldField = oldValue[field];
            const newField = newValue[field];

            if (strategy === "overwrite") {
                result[field] = newField; // already true from the spread, but explicit
            } else if (strategy === "combine") {
                const toArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
                result[field] = [...new Set([...toArray(oldField), ...toArray(newField)])];
            } else if (typeof strategy === "function") {
                result[field] = strategy(oldField, newField);
            }
        }

        return result;
    };
}

class PersistentMap {
    #data;
    #onStorage;
    #lockName;
    #pollTimer = null;

    /**
     * @param {string} storageKey - localStorage key to persist under.
     * @param {object} [options]
     * @param {(oldValue: any, newValue: any) => any} [options.merge] - per-record merge fn,
     *   called as merge(existingValue, newValue) inside set(). Defaults to a plain
     *   object spread (new fields win). Use `fieldMerge({...})` for per-field control.
     * @param {number} [options.pollMs] - if > 0, periodically re-reads storage under a
     *   shared lock every pollMs, to catch same-tab multi-instance writes and any
     *   missed/delayed `storage` events. Off (0) by default.
     */
    constructor(storageKey = "cache", options = {}) {
        this.storageKey = storageKey;
        this.merge = options.merge || PersistentMap.mergeObjects;
        this.#lockName = `persistent-map:${storageKey}`;
        this.#data = this.#loadSync();

        // Mirror other tabs' writes. Note: this event never fires in the
        // document that made the write, only in *other* tabs/documents.
        this.#onStorage = (e) => {
            if (e.key !== this.storageKey) return;
            this.#data = e.newValue ? new Map(JSON.parse(e.newValue)) : new Map();
        };
        window.addEventListener("storage", this.#onStorage);

        const pollMs = options.pollMs ?? 0;
        if (pollMs > 0) {
            this.#pollTimer = setInterval(() => this.#reconcile(), pollMs);
        }
    }

    /** Removes listeners/timers. Call this when you're done with an instance. */
    destroy() {
        window.removeEventListener("storage", this.#onStorage);
        if (this.#pollTimer) clearInterval(this.#pollTimer);
    }

    /** Default merge: shallow object spread, new value's fields win. Falls back to
     * plain overwrite when either side isn't a plain object. */
    static mergeObjects(oldValue, newValue) {
        const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);
        if (isPlain(oldValue) && isPlain(newValue)) {
            return { ...oldValue, ...newValue };
        }
        return newValue;
    }

    #loadSync() {
        try {
            return new Map(JSON.parse(localStorage.getItem(this.storageKey) || "[]"));
        } catch {
            return new Map();
        }
    }

    // Re-reads storage under a shared lock and replaces the in-memory mirror.
    // No merge needed here - once read under the lock, storage is authoritative.
    async #reconcile() {
        if (!("locks" in navigator)) {
            this.#data = this.#loadSync();
            return;
        }
        await navigator.locks.request(this.#lockName, { mode: "shared" }, async () => {
            this.#data = this.#loadSync();
        });
    }

    // Runs `fn` with exclusive, cross-tab access to the freshest data straight
    // from storage. Whatever `fn` mutates gets persisted and mirrored into #data.
    async #withLock(fn) {
        if (!("locks" in navigator)) {
            // No Web Locks support - best effort, no cross-tab atomicity guarantee.
            const map = this.#loadSync();
            await fn(map);
            this.#persist(map);
            return;
        }
        await navigator.locks.request(this.#lockName, async () => {
            const map = this.#loadSync();
            await fn(map);
            this.#persist(map);
        });
    }

    #persist(map) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify([...map]));
            this.#data = map;
        } catch (err) {
            console.error(`PersistentMap: failed to persist "${this.storageKey}"`, err);
        }
    }

    async set(key, value) {
        await this.#withLock((map) => {
            const existing = map.get(key);
            map.set(key, existing !== undefined ? this.merge(existing, value) : value);
        });
        return this;
    }

    async delete(key) {
        let result = false;
        await this.#withLock((map) => {
            result = map.delete(key);
        });
        return result;
    }

    async clear() {
        await this.#withLock((map) => map.clear());
    }

    async update(callback) {
        await this.#withLock(callback);
    }
    
    // Reads are synchronous, served from the in-memory mirror - kept current by
    // our own writes, the storage event, and (optionally) periodic polling.
    get(key) {
        return this.#data.get(key);
    }

    has(key) {
        return this.#data.has(key);
    }

    values() {
        return this.#data.values();
    }

    entries() {
        return this.#data.entries();
    }

    keys() {
        return this.#data.keys();
    }

    forEach(callback) {
        this.#data.forEach(callback);
    }

    toArray() {
        return [...this.#data.values()];
    }
    
    get size() {
        return this.#data.size;
    }
}

window.PersistentMap = PersistentMap;
window.fieldMerge = fieldMerge;

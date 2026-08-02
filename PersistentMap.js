class PersistentMap {
    #data;

    constructor(storageKey = "cache") {
        this.storageKey = storageKey;
        this.#data = this.load();
    }

    load() {
        try {
            return new Map(
                JSON.parse(
                    localStorage.getItem(this.storageKey) || "[]"
                )
            );
        } catch {
            return new Map();
        }
    }

    save() {
        try {
            localStorage.setItem(
                this.storageKey,
                JSON.stringify([...this.#data])
            );
        } catch (err) {
            console.error(err);
        }
    }

    set(key, value) {
        this.#data.set(key, value);
        this.save();
        return this;
    }

    get(key) {
        return this.#data.get(key);
    }

    has(key) {
        return this.#data.has(key);
    }

    delete(key) {
        const result = this.#data.delete(key);
        this.save();
        return result;
    }

    clear() {
        this.#data.clear();
        this.save();
    }

    values() {
        return this.#data.values();
    }

    entries() {
        return this.#data.entries();
    }

    get size() {
        return this.#data.size;
    }
}

window.PersistentMap = PersistentMap;

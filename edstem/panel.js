// ed-panel.js
//
// Reusable EdStem API Frontend assets.
// Exposes a single global: window.EdStemPanel
//
// Usage:
//   const { EdStemPanel } = window;
//   panel.innerHTML = EdStemPanel.html;
//
// Load with:
//   @require https://raw.githubusercontent.com/Cheerfulmoss/violentmonkey-sources/main/edstem/ed-panel.js

(function (global) {
    "use strict";


    global.EdStemPanel = {

        html: `
<div class="vm-panel">

    <div class="vm-section">
        <div class="vm-section-header">
            <h2 class="settings-heading">
                Developer Information
            </h2>

            <button
                id="vm-refresh"
                class="ed-button ed-focus-outline">
                Refresh
            </button>
        </div>

        <div id="vm-info"></div>
    </div>


    <div class="vm-section">
        <div class="vm-section-header">
            <h2 class="settings-heading">
                User Lookup
            </h2>
        </div>

        <p class="settings-text">
            Searches users through courses available to your account.
        </p>

        <div class="vm-search-controls">

            <input
                id="vm-user-id"
                class="ed-input-base vm-input"
                type="text"
                placeholder="User ID e.g. 514484">

            <button
                id="vm-search"
                class="ed-button ed-focus-outline">
                Search
            </button>

        </div>

        <div id="vm-search-output"></div>
    </div>

</div>
        `,


        css: `
.vm-panel {
    margin-top: 32px;
}


.vm-section {
    margin-bottom: 32px;
    padding: 20px;

    border-radius: 12px;
    border: 1px solid var(--border);

    background: var(--background-secondary);
}


.vm-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    gap: 12px;

    margin-bottom: 16px;
}


.vm-search-controls {
    display: flex;
    align-items: center;

    gap: 12px;

    margin-top: 16px;
}


.vm-input {
    flex: 1;
    min-width: 250px;
}


#vm-search {
    min-width: 110px;
}


.vm-result-card {
    margin-top: 20px;
    padding: 20px;

    border-radius: 12px;
    border: 1px solid var(--border);

    background: var(--background-primary);
}


.vm-result-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;

    gap: 16px;

    margin-bottom: 20px;
}


.vm-result-name {
    font-size: 18px;
    font-weight: 600;
}


.vm-result-id {
    margin-top: 4px;

    color: var(--text-secondary);

    font-size: 13px;
}


.vm-badge {
    padding: 4px 10px;

    border-radius: 999px;

    border: 1px solid var(--border);

    background: var(--background-secondary);

    font-size: 12px;
    font-weight: 600;
}


.vm-result-grid {
    display: grid;

    grid-template-columns: 140px 1fr;

    gap: 12px 20px;

    margin-bottom: 20px;
}


.vm-result-grid strong {
    color: var(--text-secondary);
}


.vm-json-details {
    margin-bottom: 20px;
}


.vm-json-details summary {
    cursor: pointer;

    font-weight: 600;
}


.vm-json-container {
    margin-top: 12px;
    padding: 16px;

    border-radius: 10px;

    border: 1px solid var(--border);

    background: var(--background-primary);

    overflow-x: auto;
}


.vm-json {
    margin: 0;

    font-family:
        ui-monospace,
        SFMono-Regular,
        Menlo,
        Monaco,
        Consolas,
        monospace;

    font-size: 13px;
    line-height: 1.6;

    white-space: pre-wrap;
    word-break: break-word;

    color: var(--text-primary);
}
        `
    };


})(window);

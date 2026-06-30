# Search Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Ctrl+K` / `Cmd+K` fuzzy search modal to the Corum web UI, with a TopBar search input trigger that navigates to any cluster root node.

**Architecture:** A new `web/search.jsx` file contains the pure fuzzy match algorithm, search filtering logic, and the `SearchModal` React component. The modal is wired into `App` via a `searchOpen` boolean state, with `Ctrl+K` / `Cmd+K` registered on `document`. `TopBar` gains a real `<input>` (read-only) that opens the modal on focus, styled as a frosted search bar over the orange header.

**Tech Stack:** React 18 (UMD, CDN), Babel Standalone, vanilla JS/CSS. No bundler — all files are `type="text/babel"` browser scripts.

## Global Constraints

- No npm packages added — browser UMD globals only (`React`, `ReactDOM`)
- All styles use CSS custom properties defined in `style.css` (`--paper`, `--ink`, `--ink-3`, `--ink-4`, `--rule`, `--paper-2`, `--radius`)
- `TemplateBadge` and `Icon` accessed via `window.CorumPrimitives` (loaded before `search.jsx`)
- Only search nodes where `parentId` is `undefined` or falsy — cluster root nodes only; no fields, owned schemas, enum values, etc.
- Fuzzy match runs against the full `node.id` (e.g. `orders.DomainModel.order`), case-insensitive
- Display name = `node.id.split('.').pop()` (last dot-segment)
- Max 8 results displayed; score = longest consecutive run of matched characters; ties broken by shorter `node.id` length

---

### Task 1: Fuzzy match utilities, `search.jsx` scaffold, and `index.html` registration

**Files:**
- Create: `web/search.jsx`
- Create: `web/search-utils.test.js` (Node.js algorithm verification script)
- Modify: `web/index.html`

**Interfaces:**
- Produces:
  - `window.CorumSearch.SearchModal` — React component (stub; fully implemented in Task 2)
  - Internal `fuzzyMatch(query: string, id: string): { score: number } | null`
  - Internal `searchNodes(nodes: object[], templates: object[], query: string): Array<{ node, template, score: number }>`

- [ ] **Step 1: Write the Node.js algorithm test**

Create `web/search-utils.test.js`:

```javascript
// Verify fuzzy match algorithm — run with: node web/search-utils.test.js

function fuzzyMatch(query, id) {
  if (!query) return { score: 0 };
  const q = query.toLowerCase();
  const s = id.toLowerCase();
  let qi = 0, run = 0, maxRun = 0;
  for (let i = 0; i < s.length; i++) {
    if (qi >= q.length) break;
    if (s[i] === q[qi]) { qi++; run++; if (run > maxRun) maxRun = run; }
    else { run = 0; }
  }
  return qi === q.length ? { score: maxRun } : null;
}

function searchNodes(nodes, templates, query) {
  if (!query || !query.trim()) return [];
  const templateMap = new Map(templates.map(t => [t.name, t]));
  const results = [];
  for (const node of nodes) {
    if (node.parentId) continue;
    const match = fuzzyMatch(query.trim(), node.id);
    if (!match) continue;
    results.push({ node, template: templateMap.get(node.template), score: match.score });
  }
  results.sort((a, b) => b.score - a.score || a.node.id.length - b.node.id.length);
  return results.slice(0, 8);
}

let passed = 0, failed = 0;
function assert(condition, name) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}`); failed++; }
}

// fuzzyMatch
assert(fuzzyMatch('ord', 'orders.DomainModel.order') !== null, 'matches subsequence');
assert(fuzzyMatch('xyz', 'orders.DomainModel.order') === null, 'rejects non-match');
assert(fuzzyMatch('ORD', 'orders.DomainModel.order') !== null, 'case insensitive');
assert(fuzzyMatch('', 'orders.DomainModel.order') !== null, 'empty query matches');
assert(fuzzyMatch('order', 'orders.DomainModel.order')?.score >= 5, 'consecutive run scores high');
assert(fuzzyMatch('o.o', 'orders.DomainModel.order')?.score === 1, 'non-consecutive scores low');

// searchNodes
const nodes = [
  { id: 'payments.DomainModel.payment', template: 'DomainModel', component: 'payments' },
  { id: 'orders.DomainModel.order', template: 'DomainModel', component: 'orders' },
  { id: 'orders.DomainModel.order.schemas.OrderSchema', template: 'Schema', component: 'orders', parentId: 'orders.DomainModel.order' },
];
const templates = [{ name: 'DomainModel', ui: { colour: '#f00', displayName: 'Domain Model' } }];

const results = searchNodes(nodes, templates, 'order');
assert(results.length === 2, 'returns matched root nodes only');
assert(!results.some(r => r.node.parentId), 'excludes child nodes with parentId');
assert(results[0].node.id === 'orders.DomainModel.order', 'shorter-ID tie-break works');
assert(searchNodes(nodes, templates, '').length === 0, 'empty query returns nothing');
assert(searchNodes(nodes, templates, 'zzz').length === 0, 'no-match query returns nothing');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the test and verify all assertions pass**

```bash
node web/search-utils.test.js
```

Expected output:
```
  ✓ matches subsequence
  ✓ rejects non-match
  ✓ case insensitive
  ✓ empty query matches
  ✓ consecutive run scores high
  ✓ non-consecutive scores low
  ✓ returns matched root nodes only
  ✓ excludes child nodes with parentId
  ✓ shorter-ID tie-break works
  ✓ empty query returns nothing
  ✓ no-match query returns nothing

11 passed, 0 failed
```

If any assertion fails, fix the algorithm in the test file before proceeding.

- [ ] **Step 3: Create `web/search.jsx` with the verified utilities and a stub `SearchModal`**

```jsx
/* Search modal: fuzzy match utilities and SearchModal component. */

const { useState, useEffect, useRef } = React;
const { TemplateBadge, Icon } = window.CorumPrimitives;

function fuzzyMatch(query, id) {
  if (!query) return { score: 0 };
  const q = query.toLowerCase();
  const s = id.toLowerCase();
  let qi = 0, run = 0, maxRun = 0;
  for (let i = 0; i < s.length; i++) {
    if (qi >= q.length) break;
    if (s[i] === q[qi]) { qi++; run++; if (run > maxRun) maxRun = run; }
    else { run = 0; }
  }
  return qi === q.length ? { score: maxRun } : null;
}

function searchNodes(nodes, templates, query) {
  if (!query || !query.trim()) return [];
  const templateMap = new Map(templates.map(t => [t.name, t]));
  const results = [];
  for (const node of nodes) {
    if (node.parentId) continue;
    const match = fuzzyMatch(query.trim(), node.id);
    if (!match) continue;
    results.push({ node, template: templateMap.get(node.template), score: match.score });
  }
  results.sort((a, b) => b.score - a.score || a.node.id.length - b.node.id.length);
  return results.slice(0, 8);
}

function SearchModal({ nodes, templates, onNavigate, onClose }) {
  return null; // implemented in Task 2
}

window.CorumSearch = { SearchModal };
```

- [ ] **Step 4: Register `search.jsx` in `web/index.html`**

In `web/index.html`, add one line after `primitives.jsx` and before the plugins fetch block:

```html
  <script type="text/babel" src="primitives.jsx"></script>
  <script type="text/babel" src="search.jsx"></script>
  <script type="text/babel">
    fetch('/api/plugins')
```

- [ ] **Step 5: Commit**

```bash
git add web/search.jsx web/search-utils.test.js web/index.html
git commit -m "feat: add fuzzy search utilities and register search.jsx"
```

---

### Task 2: `SearchModal` component and CSS

**Files:**
- Modify: `web/search.jsx` (replace stub `SearchModal`)
- Modify: `web/style.css` (add all search styles)

**Interfaces:**
- Consumes: `fuzzyMatch`, `searchNodes` (same file, Task 1); `TemplateBadge`, `Icon` from `window.CorumPrimitives`
- Produces: `window.CorumSearch.SearchModal({ nodes, templates, onNavigate, onClose })` — renders a full-screen backdrop with centred modal card, search input, and ranked results list

- [ ] **Step 1: Add all search CSS to the end of `web/style.css`**

```css
/* ── Search ──────────────────────────────────────── */

.topbar-search-wrap {
  margin-left: auto;
  position: relative;
  display: flex;
  align-items: center;
}

.topbar-search-icon {
  position: absolute;
  left: 10px;
  color: rgba(255, 255, 255, 0.65);
  pointer-events: none;
  font-size: 11px;
}

.topbar-search {
  width: 220px;
  padding: 5px 36px 5px 28px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: var(--radius);
  color: #fff;
  font: inherit;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.topbar-search::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

.topbar-search:hover {
  background: rgba(255, 255, 255, 0.22);
}

.topbar-search-hint {
  position: absolute;
  right: 8px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  pointer-events: none;
  user-select: none;
}

.search-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  animation: search-fade-in 0.12s ease;
}

@keyframes search-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.search-modal {
  position: absolute;
  top: 15%;
  left: 50%;
  transform: translateX(-50%);
  width: 560px;
  max-width: calc(100vw - 40px);
  background: var(--paper);
  border-radius: 10px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.search-modal-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink-3);
}

.search-modal-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 15px;
  color: var(--ink);
}

.search-modal-input::placeholder {
  color: var(--ink-4);
}

.search-results {
  padding: 4px;
  max-height: 320px;
  overflow-y: auto;
}

.search-result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.search-result-row:hover,
.search-result-row.selected {
  background: var(--paper-2);
}

.search-result-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-result-component {
  font-size: 11px;
  color: var(--ink-4);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  flex-shrink: 0;
}

.search-no-results {
  padding: 20px 16px;
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
}
```

- [ ] **Step 2: Replace the stub `SearchModal` in `web/search.jsx`**

Replace the `function SearchModal ...` stub and the `window.CorumSearch = ...` line at the bottom with:

```jsx
function SearchModal({ nodes, templates, onNavigate, onClose }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const results = searchNodes(nodes, templates, query);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (results.length > 0) setSelectedIndex(i => (i + 1) % results.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length > 0) setSelectedIndex(i => (i - 1 + results.length) % results.length);
      }
      if (e.key === 'Enter' && results[selectedIndex]) {
        onNavigate(results[selectedIndex].node.id);
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [results, selectedIndex, onNavigate, onClose]);

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="search-backdrop" onClick={handleBackdropClick}>
      <div className="search-modal">
        <div className="search-modal-input-wrap">
          <Icon name="magnifying-glass" size={15} />
          <input
            ref={inputRef}
            className="search-modal-input"
            placeholder="Search graph..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {results.length > 0 && (
          <div className="search-results">
            {results.map((result, index) => {
              const { node, template } = result;
              const name = node.id.split('.').pop();
              const colour = template?.ui?.colour ?? null;
              const tplName = template?.ui?.displayName ?? node.template;
              return (
                <div
                  key={node.id}
                  className={`search-result-row${index === selectedIndex ? ' selected' : ''}`}
                  onClick={() => { onNavigate(node.id); onClose(); }}
                  title={node.id}
                >
                  <TemplateBadge name={tplName} colour={colour} />
                  <span className="search-result-name">{name}</span>
                  <span className="search-result-component">{node.component}</span>
                </div>
              );
            })}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="search-no-results">No results</div>
        )}
      </div>
    </div>
  );
}

window.CorumSearch = { SearchModal };
```

- [ ] **Step 3: Smoke-test the modal in the browser console**

```bash
npm run web
```

Open `http://localhost:3000`. In the browser DevTools console, run:

```javascript
const container = document.createElement('div');
document.body.appendChild(container);
const root = ReactDOM.createRoot(container);
root.render(React.createElement(window.CorumSearch.SearchModal, {
  nodes: [
    { id: 'orders.DomainModel.order', template: 'DomainModel', component: 'orders' },
    { id: 'payments.API.payments', template: 'API', component: 'payments' },
  ],
  templates: [
    { name: 'DomainModel', ui: { displayName: 'Domain Model', colour: '#6366f1' } },
    { name: 'API', ui: { displayName: 'API', colour: '#10b981' } },
  ],
  onNavigate: id => { console.log('navigate ->', id); root.unmount(); container.remove(); },
  onClose: () => { root.unmount(); container.remove(); },
}));
```

Verify:
- Backdrop fades in, modal appears at ~15% from top, centred
- Input is autofocused
- Typing `ord` shows `order` result with `Domain Model` badge and `orders` component label
- Arrow keys move the selection highlight
- Enter navigates (logs to console) and closes
- Escape closes without navigating
- Clicking the backdrop closes

- [ ] **Step 4: Commit**

```bash
git add web/search.jsx web/style.css
git commit -m "feat: SearchModal component with fuzzy results and keyboard nav"
```

---

### Task 3: Wire `SearchModal` into `App` and `TopBar`

**Files:**
- Modify: `web/app.jsx`

**Interfaces:**
- Consumes: `window.CorumSearch.SearchModal` (Task 2); existing `nodes`, `templates` state and `handleNode` function in `App`

- [ ] **Step 1: Destructure `SearchModal` at the top of `web/app.jsx`**

After the existing destructuring lines at the top of the file (after `const { parseRoute, buildRoute } = window.CorumRouter;`), add:

```javascript
const { SearchModal } = window.CorumSearch;
```

- [ ] **Step 2: Update `TopBar` to accept and use `onSearchOpen`**

Replace the existing `TopBar` function (currently lines 61–70):

```jsx
function TopBar({ onSearchOpen }) {
  const inputRef = React.useRef(null);

  function handleFocus() {
    inputRef.current?.blur();
    onSearchOpen();
  }

  return (
    <div className="topbar">
      <div className="brand">
        <BrandMark size={22} color="#fff" />
        <span>corum</span>
      </div>
      <div className="topbar-search-wrap">
        <i className="fa-solid fa-magnifying-glass topbar-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="topbar-search"
          placeholder="Search graph..."
          onFocus={handleFocus}
          readOnly
        />
        <span className="topbar-search-hint">⌘K</span>
      </div>
    </div>
  );
}
```

(`readOnly` prevents mobile keyboards popping up on focus since we immediately blur and open the modal.)

- [ ] **Step 3: Add `searchOpen` state and `Ctrl+K` listener to `App`**

Inside the `App` function, add `searchOpen` state after the existing state declarations (the last `useState` call is `debugMode`, around line 730):

```javascript
const [searchOpen, setSearchOpen] = useState(false);
```

Add a new `useEffect` after the existing `hashchange` effect (around line 811):

```javascript
useEffect(() => {
  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      setSearchOpen(true);
    }
  }
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, []);
```

- [ ] **Step 4: Render `SearchModal` and pass `onSearchOpen` to `TopBar`**

In the `App` return statement, make two changes:

1. Change `<TopBar />` to:
```jsx
<TopBar onSearchOpen={() => setSearchOpen(true)} />
```

2. Add `SearchModal` as the first element inside the fragment (before `<TopBar ...>`):
```jsx
return (
  <>
    {searchOpen && (
      <SearchModal
        nodes={nodes}
        templates={templates}
        onNavigate={handleNode}
        onClose={() => setSearchOpen(false)}
      />
    )}
    <TopBar onSearchOpen={() => setSearchOpen(true)} />
    {gitMode && (
      <BranchBar ... />
    )}
    ...
```

- [ ] **Step 5: Full end-to-end verification**

```bash
npm run web
```

Open `http://localhost:3000` with a real graph loaded. Verify each behaviour:

1. TopBar shows frosted search input with magnifying glass, `Search graph...` placeholder, and `⌘K` hint
2. Click the search input → modal opens immediately, input is focused
3. Press `Escape` → modal closes, no navigation
4. Press `Ctrl+K` (Windows) or `Cmd+K` (Mac) → modal opens from anywhere in the app
5. Type a few characters → results appear ranked best-first, each row shows template badge + node name + faded component
6. `↓` / `↑` moves the highlight; selection wraps at ends
7. `Enter` on a highlighted result → navigates to that node page, modal closes
8. Click a result row → same as Enter
9. Click the dark backdrop → modal closes, no navigation
10. Navigate to a node, then press `Ctrl+K` again → modal opens correctly over the node page

- [ ] **Step 6: Commit**

```bash
git add web/app.jsx
git commit -m "feat: wire search modal into App and TopBar with Ctrl+K hotkey"
```

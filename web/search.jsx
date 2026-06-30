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
  return results.slice(0, 10);
}

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

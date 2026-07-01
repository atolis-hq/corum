/* Search modal: fuzzy match utilities and SearchModal component. */

const { useState, useEffect, useRef } = React;
const { TemplateBadge, Icon } = window.CorumPrimitives;

function SearchModal({ nodes, templates, onNavigate, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const templateMap = new Map((templates ?? []).map(t => [t.name, t]));

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }

    const url = `/api/search?q=${encodeURIComponent(q)}&limit=10`;
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]));
  }, [query]);

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
              const { node } = result;
              const template = templateMap.get(node.template);
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

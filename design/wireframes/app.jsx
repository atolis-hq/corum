/* Root app — wires everything together */

const { useState, useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "fidelity": "clean",
  "nav": "twopane",
  "overlay": "ghost",
  "lineage": "inline",
  "signals": "gutter"
}/*EDITMODE-END*/;

function App() {
  const [tab, setTab] = useState(() => localStorage.getItem('corum_tab') || 'overview');
  const [branchMode, setBranchMode] = useState('selected');
  const [selectedBranches, setSelectedBranches] = useState(['feat/checkout-v2']);
  const [tweaks, setTweaks] = useState(TWEAK_DEFAULTS);
  const [editMode, setEditMode] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('corum_theme') || 'light');

  useEffect(() => { localStorage.setItem('corum_tab', tab); }, [tab]);
  useEffect(() => {
    localStorage.setItem('corum_theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    function onMsg(e) {
      const d = e.data || {};
      if (d.type === '__activate_edit_mode') setEditMode(true);
      else if (d.type === '__deactivate_edit_mode') setEditMode(false);
    }
    function onKey(e) {
      if (e.altKey && (e.key === 't' || e.key === 'T')) {
        setTheme(t => t === 'dark' ? 'light' : 'dark');
      }
    }
    window.addEventListener('message', onMsg);
    window.addEventListener('keydown', onKey);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => { window.removeEventListener('message', onMsg); window.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('sketchy', tweaks.fidelity === 'sketchy');
  }, [tweaks.fidelity]);

  function setTweak(k, v) {
    const next = { ...tweaks, [k]: v };
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [k]: v } }, '*');
  }

  return (
    <>
      <SketchyFilter/>
      <TopBar/>
      <BranchBar
        mode={branchMode}
        setMode={setBranchMode}
        selected={selectedBranches}
        setSelected={setSelectedBranches}
      />
      <div className="main">
        <SceneNav tab={tab} setTab={setTab} tweaks={tweaks} theme={theme} setTheme={setTheme}/>
        <div style={{ flex: 1, display: 'flex' }}>
          {tab === 'overview' && <TabOverview/>}
          {tab === 'components' && <TabComponents tweaks={tweaks} embedded/>}
          {tab === 'perspective' && <TabPerspective tweaks={tweaks} embedded/>}
          {tab === 'branching' && <TabBranching tweaks={tweaks}/>}
          {tab === 'journeys' && <TabJourneys/>}
        </div>
      </div>
      {editMode && <TweaksPanel tweaks={tweaks} setTweak={setTweak}/>}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

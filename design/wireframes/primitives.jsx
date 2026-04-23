/* Shared low-fi UI primitives */

function Chip({ children, variant = 'default', title }) {
  const cls = 'chip' + (variant === 'active' ? ' active' : variant === 'accent' ? ' accent' : variant === 'ghost' ? ' ghost' : '');
  return <span className={cls} title={title}>{children}</span>;
}

function Tag({ children, kind }) {
  return <span className={'tag ' + (kind || '')}>{children}</span>;
}

function StateTag({ state }) { return <Tag kind={'state-' + state}>{state}</Tag>; }
function StabilityTag({ stability }) { return <Tag kind={'stability-' + stability}>{stability}</Tag>; }

function SigDot({ kind = 'drift', title }) {
  return <span className={'sig ' + kind} title={title} />;
}

function Seg({ options, value, onChange }) {
  return (
    <div className="seg" role="tablist">
      {options.map(o => (
        <button key={o.value} aria-selected={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Icon({ name, size = 14 }) {
  const s = size;
  const stroke = 'currentColor';
  const c = { width: s, height: s, viewBox: '0 0 16 16', fill: 'none', stroke, strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'cube': return <svg {...c}><path d="M8 1.5L14 5v6L8 14.5 2 11V5z"/><path d="M2 5l6 3 6-3M8 8v6.5"/></svg>;
    case 'api': return <svg {...c}><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 6h3M5 9h6M5 11.5h4"/></svg>;
    case 'event': return <svg {...c}><path d="M3 4h10v8H5l-2 2z"/></svg>;
    case 'model': return <svg {...c}><ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8"/></svg>;
    case 'journey': return <svg {...c}><circle cx="4" cy="4" r="1.3"/><circle cx="12" cy="12" r="1.3"/><path d="M5 5q3 0 4 3t3 3"/></svg>;
    case 'delivery': return <svg {...c}><rect x="2" y="5" width="12" height="8" rx="1"/><path d="M5 5V3h6v2"/></svg>;
    case 'graph': return <svg {...c}><circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="4" r="1.5"/><circle cx="8" cy="12" r="1.5"/><path d="M5 5l2 6M11 5l-2 6"/></svg>;
    case 'branch': return <svg {...c}><circle cx="4" cy="3.5" r="1.3"/><circle cx="4" cy="12.5" r="1.3"/><circle cx="12" cy="8" r="1.3"/><path d="M4 5v6M4 8c4 0 7 0 7-.5"/></svg>;
    case 'search': return <svg {...c}><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/></svg>;
    case 'plus': return <svg {...c}><path d="M8 3v10M3 8h10"/></svg>;
    case 'thread': return <svg {...c}><path d="M2.5 4h11v6H8l-3 3v-3H2.5z"/></svg>;
    case 'drift': return <svg {...c}><path d="M2 8q3 -4 6 0t6 0"/></svg>;
    case 'collision': return <svg {...c}><path d="M3 3l10 10M13 3L3 13"/></svg>;
    case 'link': return <svg {...c}><path d="M7 9a2.5 2.5 0 0 1 0-3.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 7a2.5 2.5 0 0 1 0 3.5l-2 2A2.5 2.5 0 0 1 3.5 9l1-1"/></svg>;
    case 'caret': return <svg {...c}><path d="M5 4l4 4-4 4"/></svg>;
    case 'caret-down': return <svg {...c}><path d="M4 6l4 4 4-4"/></svg>;
    case 'dot': return <svg {...c}><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/></svg>;
    case 'check': return <svg {...c}><path d="M3 8l3 3 7-7"/></svg>;
    case 'filter': return <svg {...c}><path d="M2 3h12l-4 5v4l-4 2V8z"/></svg>;
    case 'plug': return <svg {...c}><path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0zM8 12v2"/></svg>;
    case 'bell': return <svg {...c}><path d="M4 11V8a4 4 0 0 1 8 0v3l1 2H3zM6.5 13.5a1.5 1.5 0 0 0 3 0"/></svg>;
    case 'sun': return <svg {...c}><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4"/></svg>;
    case 'moon': return <svg {...c}><path d="M12.5 9.5A5 5 0 1 1 6.5 3.5a4 4 0 0 0 6 6z"/></svg>;
    case 'gear': return <svg {...c}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4"/></svg>;
    case 'book': return <svg {...c}><path d="M3 3h4a2 2 0 0 1 2 2v8a2 2 0 0 0-2-2H3zM13 3H9a2 2 0 0 0-2 2v8a2 2 0 0 1 2-2h4z"/></svg>;
    default: return <svg {...c}><rect x="3" y="3" width="10" height="10"/></svg>;
  }
}

function Placeholder({ children, style }) {
  return <div className="placeholder" style={style}>{children}</div>;
}

function Callout({ children, style }) {
  return <div className="callout" style={style}>{children}</div>;
}

Object.assign(window, { Chip, Tag, StateTag, StabilityTag, SigDot, Seg, Icon, Placeholder, Callout });

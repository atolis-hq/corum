import React from 'react'

export function PropertyValue({
  value,
  onNavigate
}) {
  if (value === null || value === undefined) return React.createElement("span", {
    className: "prop-empty"
  }, "-");
  if (typeof value === 'object' && 'display' in value && 'nodeId' in value) {
    return React.createElement("a", {
      className: "node-ref-link",
      onClick: () => onNavigate && onNavigate(value.nodeId)
    }, value.display);
  }
  if (typeof value === 'object' && 'display' in value) {
    return React.createElement("span", null, value.display);
  }
  if (Array.isArray(value)) {
    return React.createElement("span", null, value.length === 1 ? '1 item' : `${value.length} items`);
  }
  if (typeof value === 'object') {
    return React.createElement("span", {
      className: "prop-empty"
    }, "-");
  }
  return React.createElement("span", null, String(value));
}
export function InlineObjectValue({
  value
}) {
  if (!value || typeof value !== 'object') return React.createElement(PropertyValue, {
    value: value
  });
  const parts = Object.entries(value).filter(([, v]) => v !== null && v !== undefined);
  if (parts.length === 0) return React.createElement("span", {
    className: "prop-empty"
  }, "-");
  return React.createElement("span", null, parts.map(([k, v], i) => React.createElement(React.Fragment, {
    key: k
  }, i > 0 && React.createElement("span", {
    style: {
      margin: '0 6px',
      opacity: 0.4
    }
  }, "|"), React.createElement("span", {
    className: "prop-key-label prop-key-label--inline mono"
  }, k, ":"), ' ', String(v))));
}
export function buildPropertyRows(entries, onNavigate, depth = 0, parentPath = '', propertyHints = {}) {
  return entries.flatMap(([key, value], index) => {
    const rowPath = parentPath ? `${parentPath}.${key}` : key;
    const rowKey = `${rowPath}:${index}`;
    const hint = depth === 0 ? propertyHints[key] : null;
    if (Array.isArray(value)) {
      const rows = [{
        key: rowKey,
        label: key,
        depth,
        value: React.createElement(PropertyValue, {
          value: value,
          onNavigate: onNavigate
        })
      }];
      value.forEach((item, itemIndex) => {
        const itemPath = `${rowPath}[${itemIndex}]`;
        if (item && typeof item === 'object' && !('display' in item) && !Array.isArray(item)) {
          rows.push({
            key: `${itemPath}:group`,
            label: `[${itemIndex}]`,
            depth: depth + 1,
            value: React.createElement("span", {
              className: "prop-empty"
            }, "-")
          });
          rows.push(...buildPropertyRows(Object.entries(item), onNavigate, depth + 2, itemPath, propertyHints));
        } else {
          rows.push({
            key: `${itemPath}:value`,
            label: `[${itemIndex}]`,
            depth: depth + 1,
            value: React.createElement(PropertyValue, {
              value: item,
              onNavigate: onNavigate
            })
          });
        }
      });
      return rows;
    }
    if (value && typeof value === 'object' && !('display' in value)) {
      if (hint?.as === 'inline') {
        return [{
          key: rowKey,
          label: key,
          depth,
          value: React.createElement("span", {
            className: "prop-empty"
          }, "-")
        }, ...Object.entries(value).map(([childKey, childValue], childIndex) => ({
          key: `${rowPath}.${childKey}:${childIndex}`,
          label: childKey,
          depth: depth + 1,
          value: React.createElement(InlineObjectValue, {
            value: childValue
          })
        }))];
      }
      return [{
        key: rowKey,
        label: key,
        depth,
        value: React.createElement("span", {
          className: "prop-empty"
        }, "-")
      }, ...buildPropertyRows(Object.entries(value), onNavigate, depth + 1, rowPath, propertyHints)];
    }
    return [{
      key: rowKey,
      label: key,
      depth,
      value: React.createElement(PropertyValue, {
        value: value,
        onNavigate: onNavigate
      })
    }];
  });
}
export function TableScroll({
  children,
  className = ''
}) {
  return React.createElement("div", {
    className: "table-scroll"
  }, React.createElement("div", {
    className: className
  }, children));
}
export function PropertiesTable({
  properties,
  onNavigate,
  propertyHints = {}
}) {
  const entries = Object.entries(properties ?? {});
  const rows = buildPropertyRows(entries, onNavigate, 0, '', propertyHints);
  if (entries.length === 0) {
    return React.createElement("p", {
      className: "label-sm",
      style: {
        padding: '10px 14px'
      }
    }, "No properties.");
  }
  return React.createElement(TableScroll, null, React.createElement("table", {
    className: "prop-table"
  }, React.createElement("tbody", null, rows.map(row => React.createElement("tr", {
    key: row.key,
    className: `prop-row${row.depth > 0 ? ' nested' : ''}`
  }, React.createElement("td", {
    className: "mono prop-key-cell"
  }, React.createElement("span", {
    className: "prop-key-label",
    style: {
      '--prop-depth': row.depth
    }
  }, row.label)), React.createElement("td", null, row.value))))));
}

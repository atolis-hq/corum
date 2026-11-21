import React from 'react'

export function navigate(path) {
  window.location.hash = path;
}
export function BrandMark({
  size = 24,
  color = 'currentColor'
}) {
  return React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 110 110",
    "aria-hidden": "true"
  }, React.createElement("g", {
    transform: "translate(55 55)",
    stroke: color,
    fill: color,
    strokeLinecap: "round"
  }, React.createElement("path", {
    d: "M43.8 3.8A44 44 0 0 1 38.1 22",
    fill: "none",
    strokeWidth: "7.5",
    opacity: "0.55"
  }), React.createElement("path", {
    d: "M38.1 22a44 44 0 1 1-19.5-61",
    fill: "none",
    strokeWidth: "7.5"
  }), React.createElement("circle", {
    r: "3",
    opacity: "0.3"
  }), React.createElement("circle", {
    r: "1.8"
  }), React.createElement("path", {
    strokeWidth: "3",
    d: "M0 0v-26"
  }), React.createElement("circle", {
    cy: "-26",
    r: "4.5",
    opacity: "0.85"
  }), React.createElement("path", {
    strokeWidth: "3",
    d: "m0 0 13-22"
  }), React.createElement("circle", {
    cx: "13",
    cy: "-22",
    r: "3.5",
    opacity: "0.78"
  }), React.createElement("path", {
    strokeWidth: "3",
    d: "m0 0 23-9"
  }), React.createElement("circle", {
    cx: "23",
    cy: "-9",
    r: "4",
    opacity: "0.72"
  }), React.createElement("path", {
    strokeWidth: "2.5",
    opacity: "0.7",
    d: "m0 0 21 11"
  }), React.createElement("circle", {
    cx: "21",
    cy: "11",
    r: "3",
    opacity: "0.6"
  }), React.createElement("path", {
    strokeWidth: "2.5",
    opacity: "0.55",
    d: "m0 0 9 23"
  }), React.createElement("circle", {
    cx: "9",
    cy: "23",
    r: "3.5",
    opacity: "0.5"
  }), React.createElement("path", {
    strokeWidth: "2.5",
    opacity: "0.55",
    d: "m0 0-11 22"
  }), React.createElement("circle", {
    cx: "-11",
    cy: "22",
    r: "3",
    opacity: "0.48"
  }), React.createElement("path", {
    strokeWidth: "3",
    d: "m0 0-26 3"
  }), React.createElement("circle", {
    cx: "-26",
    cy: "3",
    r: "4",
    opacity: "0.75"
  }), React.createElement("path", {
    strokeWidth: "3",
    d: "m0 0-20-17"
  }), React.createElement("circle", {
    cx: "-20",
    cy: "-17",
    r: "4.5",
    opacity: "0.85"
  }), React.createElement("path", {
    strokeWidth: "2",
    opacity: "0.66",
    d: "m0 0-8-23"
  }), React.createElement("circle", {
    cx: "-8",
    cy: "-23",
    r: "3",
    opacity: "0.62"
  })));
}
export function Icon({
  name,
  size
}) {
  const style = size ? {
    fontSize: size
  } : undefined;
  return React.createElement("i", {
    className: `fa-solid fa-${name}`,
    style: style,
    "aria-hidden": "true"
  });
}
export function StateTag({
  state
}) {
  return React.createElement("span", {
    className: `tag state-${state}`
  }, state);
}
export function StabilityTag({
  stability
}) {
  return React.createElement("span", {
    className: `tag stability-${stability}`
  }, stability);
}
export function Chip({
  children,
  title
}) {
  return React.createElement("span", {
    className: "chip",
    title: title
  }, children);
}
export function TemplateBadge({
  name,
  colour
}) {
  const style = colour ? {
    background: colour
  } : {
    background: 'var(--ink-4)'
  };
  return React.createElement("span", {
    className: "template-badge",
    style: style
  }, name);
}

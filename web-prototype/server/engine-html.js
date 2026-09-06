const CONTROLLER_REMAP_TAG = '<script src="/controller-remap.js"></script>';

export function withControllerRemap(html) {
  const source = String(html || "");
  if (source.includes(CONTROLLER_REMAP_TAG)) return source;
  if (source.includes("</head>")) {
    return source.replace("</head>", `  ${CONTROLLER_REMAP_TAG}\n</head>`);
  }
  return `${CONTROLLER_REMAP_TAG}\n${source}`;
}

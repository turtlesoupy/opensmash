const CONTROLLER_REMAP_TAG = '<script src="/controller-remap.js"></script>';

export function withControllerRemap(html) {
  const source = String(html || "");
  if (source.includes(CONTROLLER_REMAP_TAG)) return source;
  if (source.includes("</head>")) {
    return source.replace("</head>", `  ${CONTROLLER_REMAP_TAG}\n</head>`);
  }
  return `${CONTROLLER_REMAP_TAG}\n${source}`;
}

const KEYBOARD_TAG = '<script src="/n64-keyboard-runtime.js"></script><script>openSmashN64Keyboard.installEngine();</script>';
export function withN64Keyboard(html) {
  if (html.includes(KEYBOARD_TAG)) return html;
  return html.includes('</head>') ? html.replace('</head>', `${KEYBOARD_TAG}\n</head>`) : `${KEYBOARD_TAG}\n${html}`;
}

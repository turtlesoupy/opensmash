// Keep modal input protection without scanning the entire roster every frame.
// Visibility and open state are checked live; only the list of dialogs is cached.
export function createGameInputBlocker(root: Document = document) {
  let dirty = true, disposed = false;
  let dialogs: Element[] = [];
  const observer = new MutationObserver(() => { dirty = true; });
  observer.observe(root, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['role'],
  });
  return {
    isBlocked() {
      if (disposed) return false;
      // Include changes made earlier in this same event, before observer delivery.
      if (observer.takeRecords().length) dirty = true;
      if (dirty) {
        dialogs = [...root.querySelectorAll('dialog, [role="dialog"]')];
        dirty = false;
      }
      return dialogs.some(element => (
        (element.localName === 'dialog' && element.hasAttribute('open')) ||
        (element.getAttribute('role') === 'dialog' && element.getAttribute('aria-modal') === 'true')
      ) && element.getClientRects().length > 0);
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      dialogs = [];
    },
  };
}

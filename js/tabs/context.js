// Tabs runtime context (CLEANUP S5) — the shared, multi-writer session state + module map, so the tabs.js
// slices (new-diagram-modal / close-manager / groups / session-store / tab-bar-render) read+mutate ONE copy.
// tabs/groups are ARRAYS shared by reference (each module does `const { tabs, groups } = tbctx` and mutates in
// place). activeTabId/nextId/nextGroupId/ungroupedCollapsed are PROPERTIES on tbctx (not module-local `let`s) so a
// write in any slice is seen by all — the multi-writer fix (a live-binding `export let` would NOT propagate).
// modules is the {graph,paper,canvas,selection,history,persistence,stencil} map, wired in tabs.init(). The five
// forward-refs (saveTabs/switchTab/closeTab/setTabGroup/showNewDiagramModal) let tab-bar-render's DnD reach the
// other slices without a cycle. Read tbctx.modules.X / tbctx.<forwardRef> INSIDE function bodies (wired in init).
export const tbctx = {
  tabs: [], groups: [],
  activeTabId: null, nextId: 1, nextGroupId: 1, ungroupedCollapsed: false,
  modules: null,
  saveTabs: null, switchTab: null, closeTab: null, setTabGroup: null, showNewDiagramModal: null, importDiagramAsTab: null,
  createDiagramOfType: null, getGroup: null,
  // close-manager slice reaches these facade mechanics + group renderers via forward-ref:
  deleteBrowserArchive: null, doCloseTab: null, forgetBrowserSaveName: null, getGroups: null, getTabGraphJSON: null, groupBadgeHtml: null,
  // session-store slice reaches these facade lifecycle fns via forward-ref:
  generateId: null, markDirty: null, notifyChange: null, renameTab: null, render: null, reorderTabsByGroup: null,
};

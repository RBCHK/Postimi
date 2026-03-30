// Shared module-level state for composer sidebar open/close.
// Survives component remounts (key={id} destroys components on navigation).
// Used by both ComposerSidebarContainer and HomeComposerPanel
// to animate transitions between home ↔ draft pages.

// undefined = first mount ever (no animation), boolean = previous visual state.
let prevComposerOpen: boolean | undefined;

export function getPrevComposerOpen() {
  return prevComposerOpen;
}

export function setPrevComposerOpen(value: boolean) {
  prevComposerOpen = value;
}

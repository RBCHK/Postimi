# WebKit: fill() doesn't trigger React onChange on controlled inputs

## Problem

Playwright's `fill()` may not trigger React's `onChange` on controlled components in WebKit (Safari engine). The value appears in the input but React state doesn't update, leaving buttons that depend on the state (e.g. Send) disabled.

## Solution

Use `pressSequentially()` instead of `fill()` for WebKit/mobile-safari tests:

```typescript
await textarea.click();
await textarea.pressSequentially("message text", { delay: 20 });

// Wait for button to become enabled before clicking
const sendButton = page.locator('button[aria-label="Send message"]:not([disabled])');
await sendButton.waitFor({ timeout: 5_000 });
await sendButton.click();
```

## Why

WebKit processes synthetic input events differently than Chromium. `fill()` sets the value directly, which may bypass React's event system. `pressSequentially()` simulates real key presses that properly trigger onChange handlers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRegisterHostActionButton } from '../src/ui.js';

// The host draws `location: 'action'` buttons itself at a fixed top-right position on the chat
// screen. It cannot be dragged, so it must not sit next to the draggable chip by default.

test('host action button is not registered while the draggable chip is available', () => {
  assert.equal(shouldRegisterHostActionButton({ userEnabled: false, chipAvailable: true }), false);
});

test('host action button is registered when the user turns it on', () => {
  assert.equal(shouldRegisterHostActionButton({ userEnabled: true, chipAvailable: true }), true);
});

test('host action button is the fallback entry point when the chip cannot be shown', () => {
  assert.equal(shouldRegisterHostActionButton({ userEnabled: false, chipAvailable: false }), true);
});

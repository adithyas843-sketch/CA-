import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, constantTimeEqual } from '../worker/index.ts';

test('password hashes use a unique salt and verify the original password', async () => {
  const first = await hashPassword('A sufficiently long password 1');
  const second = await hashPassword('A sufficiently long password 1');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('A sufficiently long password 1', first), true);
  assert.equal(await verifyPassword('A sufficiently long password 2', first), false);
});

test('password verification rejects malformed stored hashes', async () => {
  assert.equal(await verifyPassword('password', 'invalid'), false);
  assert.equal(await verifyPassword('password', 'pbkdf2-sha256$1$bad$bad'), false);
});

test('setup token comparison handles equal and unequal values', () => {
  assert.equal(constantTimeEqual('owner-token-abc', 'owner-token-abc'), true);
  assert.equal(constantTimeEqual('owner-token-abc', 'owner-token-abd'), false);
  assert.equal(constantTimeEqual('short', 'longer'), false);
});

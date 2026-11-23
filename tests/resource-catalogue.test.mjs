import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalResourceUrl } from '../worker/index.ts';

test('canonical URLs remove tracking parameters and fragments', () => {
  assert.equal(canonicalResourceUrl('https://Example.com/lesson?utm_source=mail&id=4#notes'), 'https://example.com/lesson?id=4');
});

test('YouTube short and watch URLs deduplicate to the same video URL', () => {
  assert.equal(canonicalResourceUrl('https://youtu.be/abc123?t=60'), 'https://www.youtube.com/watch?v=abc123');
  assert.equal(canonicalResourceUrl('https://youtube.com/watch?v=abc123&utm_campaign=study'), 'https://www.youtube.com/watch?v=abc123');
});

test('YouTube playlists remain associated with the video and unsafe URLs are rejected', () => {
  assert.equal(canonicalResourceUrl('https://www.youtube.com/watch?v=abc123&list=PLxyz'), 'https://www.youtube.com/watch?v=abc123&list=PLxyz');
  assert.equal(canonicalResourceUrl('javascript:alert(1)'), null);
  assert.equal(canonicalResourceUrl('https://user:pass@example.com/resource'), null);
});

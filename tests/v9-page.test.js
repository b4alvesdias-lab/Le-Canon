const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const v9 = fs.readFileSync('v9.html', 'utf8');
const v8 = fs.readFileSync('index.html', 'utf8');

test('la page de test V9 charge les modules dans le bon ordre', () => {
  const firebase = v9.indexOf('firebase-firestore-compat.js');
  const core = v9.indexOf('src="multiplayer-v9.js"');
  const adapter = v9.indexOf('src="multiplayer-v9-adapter.js"');
  const controller = v9.indexOf('src="multiplayer-v9-controller.js"');
  assert.ok(firebase >= 0 && core > firebase && adapter > core && controller > adapter);
  assert.match(v9, /<title>Le Canon V9/);
});

test('la page publique V8 reste inchangée dans cette branche de travail', () => {
  assert.match(v8, /<title>Le Canon V8/);
  assert.doesNotMatch(v8, /src="multiplayer-v9-controller.js"/);
});

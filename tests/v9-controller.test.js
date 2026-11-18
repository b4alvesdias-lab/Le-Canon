const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('le contrôleur V9 se charge et remplace les points d’entrée du moteur', () => {
  const source = fs.readFileSync('multiplayer-v9-controller.js', 'utf8');
  const original = {
    attachOnlineRoom() {},
    leaveOnlineRoom() {},
    checkSetup() {},
    confirmPick() {},
    playHandCard() {},
    endGame() {},
    newGame() {}
  };
  const context = {
    ...original,
    CanonMultiplayerV9: {},
    CanonMultiplayerV9Adapter: {},
    addEventListener() {},
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'multiplayer-v9-controller.js' });
  for (const name of Object.keys(original)) {
    assert.equal(typeof context[name], 'function');
    assert.notEqual(context[name], original[name], name + ' doit être raccordé au contrôleur');
  }
});

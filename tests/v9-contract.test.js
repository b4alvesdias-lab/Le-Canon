const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../multiplayer-v9.js');

const api = global.CanonMultiplayerV9;

test('le module V9 expose ses fonctions principales', () => {
  assert.equal(typeof api.configure, 'function');
  assert.equal(typeof api.createGame, 'function');
  assert.equal(typeof api.listen, 'function');
  assert.equal(typeof api.updateOwnHand, 'function');
  assert.equal(typeof api.commitTurn, 'function');
  assert.equal(typeof api.finish, 'function');
  assert.equal(typeof api.stop, 'function');
});

test('un état public simple est accepté', () => {
  assert.doesNotThrow(() => api.assertPublicData({
    schemaVersion: 9,
    status: 'playing',
    revision: 1,
    currentPlayerUid: 'uid-host',
    players: [
      { uid: 'uid-host', name: 'Alice', q: 0, a: 0, r: 0 },
      { uid: 'uid-guest', name: 'Bob', q: 0, a: 0, r: 0 }
    ],
    saisonIdx: 0,
    tourInSaison: 0,
    meteo: { name: 'Soleil' },
    evenement: null,
    allChosen: []
  }, 'state'));
});

test('une main ne peut pas être publiée dans les données communes', () => {
  for (const key of ['hand', 'privateHand', 'privateCards', 'cdm', 'mat']) {
    assert.throws(
      () => api.assertPublicData({ players: [{ uid: 'u1', [key]: [] }] }, 'state'),
      /donnée privée/
    );
  }
});

test('les cartes proposées au joueur actif restent privées', () => {
  for (const key of ['drawn', 'drawnCards', 'options', 'selectedHandCard']) {
    assert.throws(
      () => api.assertPublicData({ [key]: [] }, 'state'),
      /donnée privée/
    );
  }
});

test('le contrôle de confidentialité descend dans les objets imbriqués', () => {
  assert.throws(
    () => api.assertPublicData({ players: [{ profile: { privateCards: ['carte'] } }] }, 'state'),
    /donnée privée/
  );
});

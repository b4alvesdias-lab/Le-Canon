const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../multiplayer-v9.js');
require('../multiplayer-v9-adapter.js');

const adapter = global.CanonMultiplayerV9Adapter;
const multiplayer = global.CanonMultiplayerV9;

const profile = (name) => ({
  name,
  cepage: { name: 'Savagnin', desc: 'Cépage du Jura', bonus: '+1 qualité', malus: 'Aucun', assoc: '—' },
  terroir: { name: 'Marne', desc: 'Sol jurassien', bonus: '+1 arôme', malus: 'Aucun', assoc: '—' },
  mode: { name: 'Bio', bonus: '+1 qualité', malus: 'Aucun', assoc: '—' },
  q: 0, a: 0, r: 0,
  cdm: [{ name: 'Aide', type: 'cdm-b', effet: 'Aide', played: false, appliquer() {} }],
  mat: [{ name: 'Cuve', type: 'mat-b', effet: 'Cuve', played: false, appliquer() {} }],
  drawn: [{ name: 'secret local' }]
});

test('l’adaptateur expose les conversions nécessaires', () => {
  for (const fn of ['publicCard', 'publicProfile', 'privatePayload', 'buildInitialState', 'buildNextState', 'hydratePlayer']) {
    assert.equal(typeof adapter[fn], 'function');
  }
});

test('le profil public exclut les cartes de main et les données locales', () => {
  const pub = adapter.publicProfile(profile('Alice'), 'uid-a');
  assert.equal(pub.uid, 'uid-a');
  assert.equal(pub.name, 'Alice');
  assert.equal(Object.hasOwn(pub, 'cdm'), false);
  assert.equal(Object.hasOwn(pub, 'mat'), false);
  assert.equal(Object.hasOwn(pub, 'drawn'), false);
  assert.doesNotThrow(() => multiplayer.assertPublicData({ players: [pub] }, 'state'));
});

test('les cartes de main et les cartes proposées sont dans le paquet privé', () => {
  const priv = adapter.privatePayload(profile('Alice'), [
    { name: 'Carte secrète', bonus: '+1 qualité', malus: 'Aucun', assoc: '—' }
  ]);
  assert.equal(priv.hand.cdm.length, 1);
  assert.equal(priv.hand.mat.length, 1);
  assert.equal(priv.drawn[0].name, 'Carte secrète');
  assert.equal(Object.hasOwn(priv.hand.cdm[0], 'appliquer'), false);
  assert.doesNotThrow(() => JSON.stringify(priv));
});

test('l’état initial relie les profils aux UID sans publier les mains', () => {
  const game = { players: [profile('Alice'), profile('Bob')], saisonIdx: 0, tourInSaison: 0,
    meteo: { name: 'Soleil', bonus: '+1 qualité', malus: 'Aucun' }, evenement: null };
  const state = adapter.buildInitialState(game, ['uid-a', 'uid-b']);
  assert.equal(state.currentPlayerUid, 'uid-a');
  assert.deepEqual(state.players.map(p => p.uid), ['uid-a', 'uid-b']);
  assert.doesNotThrow(() => multiplayer.assertPublicData(state, 'state'));
});

test('l’état suivant publie les choix validés et conserve le prochain joueur', () => {
  const game = { players: [profile('Alice'), profile('Bob')], saisonIdx: 0, tourInSaison: 0,
    meteo: null, evenement: null,
    allChosen: [{ player: 0, card: { name: 'Taille', bonus: '+1 qualité', malus: 'Aucun', assoc: '—' } }] };
  const state = adapter.buildNextState(game, ['uid-a', 'uid-b'], 1);
  assert.equal(state.currentPlayerUid, 'uid-b');
  assert.equal(state.allChosen[0].playerUid, 'uid-a');
  assert.equal(state.allChosen[0].card.name, 'Taille');
  assert.doesNotThrow(() => multiplayer.assertPublicData(state, 'state'));
});

test('la reconstruction d’un joueur restaure les fonctions depuis les catalogues locaux', () => {
  const defCdm = { name: 'Aide', type: 'cdm-b', effet: 'Aide', appliquer: () => 'ok' };
  const defMat = { name: 'Cuve', type: 'mat-b', effet: 'Cuve', appliquer: () => 'ok' };
  const saved = adapter.privatePayload(profile('Alice'), []);
  const player = adapter.hydratePlayer(
    adapter.publicProfile(profile('Alice'), 'uid-a'),
    { hand: saved.hand },
    { cdm: [defCdm], mat: [defMat] }
  );
  assert.equal(typeof player.cdm[0].appliquer, 'function');
  assert.equal(typeof player.mat[0].appliquer, 'function');
});

test('les pseudos publics sont nettoyés avant insertion dans le HTML', () => {
  const cleaned = adapter.publicProfile(profile('<b>Alice</b>'), 'uid-a');
  assert.equal(cleaned.name, 'bAlice/b');
  assert.equal(cleaned.name.includes('<'), false);
  assert.equal(cleaned.name.includes('>'), false);
});

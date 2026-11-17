const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');
const {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  Timestamp
} = require('firebase/firestore');

const projectId = 'demo-le-canon-v9';
const roomId = 'ROOM01';
const rules = fs.readFileSync('firestore.v9.rules', 'utf8');
let env;

const trait = name => ({
  name,
  desc: 'Description de test',
  bonus: '+1 qualité',
  malus: 'Aucun',
  assoc: 'Association de test'
});
const mode = name => ({
  name,
  bonus: '+1 qualité',
  malus: 'Aucun',
  assoc: 'Association de test'
});
const publicPlayer = (uid, name) => ({
  uid,
  name,
  cepage: trait('Savagnin'),
  terroir: trait('Marne'),
  mode: mode('Bio'),
  q: 0,
  a: 0,
  r: 0
});
const setupProfile = (uid, name) => ({
  ...publicPlayer(uid, name),
  ready: true,
  updatedAt: Timestamp.now()
});
const privateData = uid => ({
  uid,
  hand: { cdm: [], mat: [] },
  drawn: [],
  drawnRevision: -1,
  updatedAt: Timestamp.now()
});
const initialState = () => ({
  schemaVersion: 9,
  status: 'playing',
  revision: 1,
  currentPlayerUid: 'uid-host',
  players: [publicPlayer('uid-host', 'Alice'), publicPlayer('uid-guest', 'Bob')],
  saisonIdx: 0,
  tourInSaison: 0,
  meteo: { name: 'Soleil', bonus: '+1 qualité', malus: 'Aucun' },
  evenement: null,
  allChosen: [],
  turnStatus: 'choosing',
  updatedAt: Timestamp.now()
});
const path = suffix => 'rooms/' + roomId + '/' + suffix;
const dbFor = uid => env.authenticatedContext(uid).firestore();

async function prepareBoth() {
  await assertSucceeds(setDoc(doc(dbFor('uid-host'), path('game/players/items/uid-host')), setupProfile('uid-host', 'Alice')));
  await assertSucceeds(setDoc(doc(dbFor('uid-guest'), path('game/players/items/uid-guest')), setupProfile('uid-guest', 'Bob')));
  await assertSucceeds(setDoc(doc(dbFor('uid-host'), path('private/uid-host')), privateData('uid-host')));
  await assertSucceeds(setDoc(doc(dbFor('uid-guest'), path('private/uid-guest')), privateData('uid-guest')));
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'rooms/' + roomId), { hostUid: 'uid-host', status: 'waiting' });
    await setDoc(doc(db, path('members/uid-host')), { uid: 'uid-host', role: 'host' });
    await setDoc(doc(db, path('members/uid-guest')), { uid: 'uid-guest', role: 'player' });
  });
});

after(async () => {
  if (env) await env.cleanup();
});

test('chaque joueur écrit son profil et lit uniquement sa propre main', async () => {
  const hostDb = dbFor('uid-host');
  const guestDb = dbFor('uid-guest');
  await assertSucceeds(setDoc(doc(hostDb, path('private/uid-host')), privateData('uid-host')));
  await assertSucceeds(setDoc(doc(guestDb, path('game/players/items/uid-guest')), setupProfile('uid-guest', 'Bob')));
  await assertSucceeds(setDoc(doc(guestDb, path('private/uid-guest')), privateData('uid-guest')));
  await assertSucceeds(getDoc(doc(guestDb, path('private/uid-guest'))));
  await assertFails(getDoc(doc(guestDb, path('private/uid-host'))));
});

test('seul l’hôte lance une partie et tous les profils doivent être prêts', async () => {
  await prepareBoth();
  const stateRefGuest = doc(dbFor('uid-guest'), path('game/state'));
  const stateRefHost = doc(dbFor('uid-host'), path('game/state'));
  await assertFails(setDoc(stateRefGuest, initialState()));
  await assertSucceeds(setDoc(stateRefHost, initialState()));
});

test('les champs privés imbriqués sont refusés dans les profils publics', async () => {
  await prepareBoth();
  const bad = initialState();
  bad.players[0].hand = [{ name: 'carte secrète' }];
  await assertFails(setDoc(doc(dbFor('uid-host'), path('game/state')), bad));
});

test('seul le joueur actif fait avancer la révision et écrit une action', async () => {
  await prepareBoth();
  const hostDb = dbFor('uid-host');
  const guestDb = dbFor('uid-guest');
  const stateHost = doc(hostDb, path('game/state'));
  await assertSucceeds(setDoc(stateHost, initialState()));
  await assertSucceeds(updateDoc(stateHost, {
    revision: 2,
    currentPlayerUid: 'uid-guest',
    updatedAt: Timestamp.now()
  }));
  await assertFails(updateDoc(stateHost, {
    revision: 3,
    currentPlayerUid: 'uid-host',
    updatedAt: Timestamp.now()
  }));
  await assertSucceeds(updateDoc(doc(guestDb, path('game/state')), {
    revision: 3,
    currentPlayerUid: 'uid-host',
    updatedAt: Timestamp.now()
  }));
  await assertFails(setDoc(doc(hostDb, path('actions/action-host')), {
    by: 'uid-host',
    type: 'turn',
    summary: 'Action hors tour',
    createdAt: Timestamp.now()
  }));
  await assertSucceeds(setDoc(doc(guestDb, path('actions/action-guest')), {
    by: 'uid-guest',
    type: 'turn',
    summary: 'Action du joueur actif',
    createdAt: Timestamp.now()
  }));
});

test('une main privée ne peut être modifiée que par son propriétaire et pendant son tour', async () => {
  await prepareBoth();
  const hostDb = dbFor('uid-host');
  const guestDb = dbFor('uid-guest');
  await assertSucceeds(setDoc(doc(hostDb, path('game/state')), initialState()));
  await assertFails(updateDoc(doc(guestDb, path('private/uid-guest')), {
    drawn: [],
    drawnRevision: 1,
    updatedAt: Timestamp.now()
  }));
  await assertSucceeds(updateDoc(doc(hostDb, path('private/uid-host')), {
    drawn: [{ name: 'Taille', bonus: '+1 qualité', malus: 'Aucun', assoc: '—' }],
    drawnRevision: 1,
    updatedAt: Timestamp.now()
  }));
});

test('les profils de préparation sont verrouillés après le lancement', async () => {
  await prepareBoth();
  await assertSucceeds(setDoc(doc(dbFor('uid-host'), path('game/state')), initialState()));
  await assertFails(updateDoc(doc(dbFor('uid-guest'), path('game/players/items/uid-guest')), {
    name: 'Bob modifié'
  }));
});

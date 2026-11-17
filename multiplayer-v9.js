/* Le Canon V9 — couche de synchronisation multijoueur
 * Ce module est volontairement isolé : il ne remplace pas encore le moteur V8.
 * Firestore compat doit être chargé avant ce fichier.
 *
 * Modèle Firestore :
 * rooms/{code}/game/state       état public (tour, joueurs, scores, saison, météo)
 * rooms/{code}/private/{uid}    main et informations privées du joueur uid
 * rooms/{code}/actions/{id}     journal des actions validées
 *
 * IMPORTANT : publier les règles Firestore V9 correspondantes avant activation.
 */
(function () {
  'use strict';

  const api = {
    db: null,
    code: null,
    uid: null,
    unsubPublic: null,
    unsubPrivate: null,
    onPublic: null,
    onPrivate: null,

    configure(db, roomCode, uid) {
      if (!db || !roomCode || !uid) throw new Error('Connexion V9 incomplète.');
      this.stop();
      this.db = db;
      this.code = String(roomCode).toUpperCase();
      this.uid = uid;
    },

    roomRef() {
      if (!this.db || !this.code || !this.uid) throw new Error('Synchronisation V9 non configurée.');
      return this.db.collection('rooms').doc(this.code);
    },

    async createGame(publicState, privateHand) {
      const room = this.roomRef();
      const member = await room.collection('members').doc(this.uid).get();
      if (!member.exists) throw new Error('Tu ne fais pas partie de ce salon.');
      const batch = this.db.batch();
      batch.set(room.collection('game').doc('state'), {
        schemaVersion: 9,
        status: 'playing',
        revision: 1,
        currentPlayerUid: this.uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        ...publicState
      });
      batch.set(room.collection('private').doc(this.uid), {
        uid: this.uid,
        hand: privateHand || {},
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await batch.commit();
    },

    listen(handlers) {
      const room = this.roomRef();
      this.onPublic = handlers && handlers.onPublic;
      this.onPrivate = handlers && handlers.onPrivate;
      this.unsubPublic = room.collection('game').doc('state').onSnapshot(
        snap => { if (snap.exists && this.onPublic) this.onPublic(snap.data()); },
        err => console.error('[Canon V9] état public', err)
      );
      // Le chemin contient uniquement l'UID de cet appareil : aucune lecture des mains adverses.
      this.unsubPrivate = room.collection('private').doc(this.uid).onSnapshot(
        snap => { if (snap.exists && this.onPrivate) this.onPrivate(snap.data()); },
        err => console.error('[Canon V9] main privée', err)
      );
    },

    async updateOwnHand(hand) {
      const ref = this.roomRef().collection('private').doc(this.uid);
      await ref.set({
        uid: this.uid,
        hand: hand || {},
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    },

    async commitTurn(expectedRevision, nextPublicState, action) {
      const room = this.roomRef();
      const stateRef = room.collection('game').doc('state');
      const actionRef = room.collection('actions').doc();
      return this.db.runTransaction(async tx => {
        const snap = await tx.get(stateRef);
        if (!snap.exists) throw new Error('La partie en ligne n’a pas été initialisée.');
        const current = snap.data();
        if (current.status !== 'playing') throw new Error('La partie n’est pas en cours.');
        if (current.currentPlayerUid !== this.uid) throw new Error('Ce n’est pas ton tour.');
        if (Number(current.revision) !== Number(expectedRevision)) {
          throw new Error('La partie a changé sur un autre téléphone. Actualise et réessaie.');
        }
        tx.update(stateRef, {
          ...nextPublicState,
          revision: Number(current.revision) + 1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        tx.set(actionRef, {
          by: this.uid,
          type: String(action && action.type || 'turn'),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          // Ne jamais placer une main ou le contenu des cartes privées dans ce journal.
          summary: String(action && action.summary || '').slice(0, 160)
        });
        return Number(current.revision) + 1;
      });
    },

    async finish(finalPublicState) {
      const ref = this.roomRef().collection('game').doc('state');
      await ref.set({
        ...finalPublicState,
        status: 'finished',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    },

    stop() {
      if (this.unsubPublic) this.unsubPublic();
      if (this.unsubPrivate) this.unsubPrivate();
      this.unsubPublic = null;
      this.unsubPrivate = null;
    }
  };

  window.CanonMultiplayerV9 = api;
})();
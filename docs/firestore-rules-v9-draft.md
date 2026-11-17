# Le Canon — règles Firestore V9 (brouillon à tester)

Ces règles ne sont pas prêtes pour la production. Elles conservent le principe des salons V8 et ajoutent des chemins séparés pour l’état public et les mains privées. Ne pas les publier avant d’avoir validé le schéma exact des documents et les tests avec deux comptes.

Principes :
- un membre peut lire l’état public ;
- seul l’hôte identifié par `rooms/{roomId}.hostUid` peut créer l’état initial ;
- seul le joueur dont c’est le tour peut faire avancer la révision ;
- chaque joueur ne lit et n’écrit que son propre document privé ;
- les actions ne contiennent jamais de données privées.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isMember(roomId) {
      return signedIn()
        && exists(/databases/$(database)/documents/rooms/$(roomId)/members/$(request.auth.uid));
    }

    function isHost(roomId) {
      return isMember(roomId)
        && get(/databases/$(database)/documents/rooms/$(roomId)).data.hostUid == request.auth.uid;
    }

    function isRoomMember(roomId, playerUid) {
      return playerUid is string
        && exists(/databases/$(database)/documents/rooms/$(roomId)/members/$(playerUid));
    }

    match /rooms/{roomId} {
      // Les règles de création/rejoindre/quitter du salon V8 restent à conserver
      // telles quelles ; ce bloc ne les remplace pas.

      match /game/{docId} {
        allow read: if docId == 'state' && isMember(roomId);

        allow create: if docId == 'state'
          && isHost(roomId)
          && request.resource.data.schemaVersion == 9
          && request.resource.data.status == 'playing'
          && request.resource.data.revision == 1
          && isRoomMember(roomId, request.resource.data.currentPlayerUid)
          && request.resource.data.keys().hasOnly([
            'schemaVersion', 'status', 'revision', 'currentPlayerUid',
            'players', 'saisonIdx', 'tourInSaison', 'meteo',
            'evenement', 'allChosen', 'turnStatus', 'updatedAt'
          ]);

        allow update: if docId == 'state'
          && isMember(roomId)
          && resource.data.status == 'playing'
          && resource.data.currentPlayerUid == request.auth.uid
          && request.resource.data.revision == resource.data.revision + 1
          && request.resource.data.status in ['playing', 'finished']
          && isRoomMember(roomId, request.resource.data.currentPlayerUid)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
            'status', 'revision', 'currentPlayerUid', 'players',
            'saisonIdx', 'tourInSaison', 'meteo', 'evenement',
            'allChosen', 'turnStatus', 'updatedAt'
          ]);

        allow delete: if false;
      }

      // Profils de préparation : visibles par les membres, modifiables par leur propriétaire.
      match /game/players/items/{playerUid} {
        allow read: if isMember(roomId);
        allow create, update: if signedIn()
          && request.auth.uid == playerUid
          && isMember(roomId)
          && request.resource.data.uid == request.auth.uid
          && request.resource.data.ready == true
          && request.resource.data.keys().hasOnly([
            'uid', 'name', 'cepage', 'terroir', 'mode',
            'q', 'a', 'r', 'ready', 'updatedAt'
          ]);
        allow delete: if false;
      }

      match /private/{playerUid} {
        allow read: if signedIn()
          && request.auth.uid == playerUid
          && isMember(roomId);

        allow create, update: if signedIn()
          && request.auth.uid == playerUid
          && isMember(roomId)
          && request.resource.data.uid == request.auth.uid
          && request.resource.data.keys().hasOnly(['uid', 'hand', 'drawn', 'drawnRevision', 'updatedAt']);

        allow delete: if false;
      }

      match /actions/{actionId} {
        allow read: if isMember(roomId);

        allow create: if isMember(roomId)
          && request.resource.data.by == request.auth.uid
          && request.resource.data.type is string
          && request.resource.data.type.size() <= 40
          && request.resource.data.summary is string
          && request.resource.data.summary.size() <= 160
          && request.resource.data.keys().hasOnly(['by', 'type', 'summary', 'createdAt']);

        allow update, delete: if false;
      }
    }
  }
}
```

## Points à vérifier avant publication

1. Le schéma public final doit correspondre exactement à la liste des champs autorisés ci-dessus. Si d’autres champs sont nécessaires, les ajouter après vérification.
2. Les règles ne valident pas à elles seules la justesse des calculs de score ni la légitimité de chaque carte jouée.
3. Les profils de préparation sont publiés dans `game/players/items/{uid}` ; les mains et les cartes proposées restent dans `private/{uid}`. Le champ `drawnRevision` lie les propositions à une révision précise.
4. Les règles doivent aussi autoriser le champ privé `drawn` et `drawnRevision`, ainsi que le sous-chemin de préparation `game/players/items/{uid}`. Les règles V8 de la racine `rooms/{roomId}` et `members/{memberUid}` doivent être conservées et fusionnées soigneusement.
5. Pour une vraie protection anti-triche, déplacer la validation des actions et des scores dans un backend de confiance (Cloud Functions).

**Ne pas remplacer les règles Firestore actuellement publiées par ce brouillon.**

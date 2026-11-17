# Le Canon — règles Firestore V9 (brouillon)

Ces règles sont une base de travail pour le module `multiplayer-v9.js`. Elles ne doivent PAS être publiées avant intégration et tests complets.

Principes :
- les documents de main sont lisibles et modifiables uniquement par leur propriétaire ;
- l'état public est lisible par les membres du salon ;
- seul l'hôte initialise la partie ;
- une mise à jour de tour doit partir du joueur dont c'est le tour et incrémenter la révision ;
- les actions ne contiennent jamais le contenu des mains.

Avant publication, vérifier que les règles des salons et membres V8 sont conservées et que la création/rejoindre/quitter reste fonctionnelle.

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
        && get(/databases/$(database)/documents/rooms/$(roomId)/members/$(request.auth.uid)).data.role == 'host';
    }

    match /rooms/{roomId} {
      // À fusionner avec les règles V8 existantes, pas à remplacer à l'aveugle.
      match /game/{docId} {
        allow read: if isMember(roomId);
        allow create: if docId == 'state' && isHost(roomId)
          && request.resource.data.schemaVersion == 9
          && request.resource.data.status == 'playing'
          && request.resource.data.revision == 1;
        allow update: if docId == 'state' && isMember(roomId)
          && resource.data.status == 'playing'
          && resource.data.currentPlayerUid == request.auth.uid
          && request.resource.data.revision == resource.data.revision + 1;
        allow delete: if false;
      }

      match /private/{playerUid} {
        allow read: if signedIn() && request.auth.uid == playerUid;
        allow create, update: if signedIn() && request.auth.uid == playerUid
          && request.resource.data.uid == request.auth.uid;
        allow delete: if false;
      }

      match /actions/{actionId} {
        allow read: if isMember(roomId);
        allow create: if isMember(roomId)
          && request.resource.data.by == request.auth.uid
          && request.resource.data.summary is string
          && request.resource.data.summary.size() <= 160;
        allow update, delete: if false;
      }
    }
  }
}
```

ATTENTION : ce brouillon n'est pas encore une politique de sécurité suffisante pour une mise en production. En particulier, il faudra valider les transitions d'état, les champs autorisés et les limites de fréquence côté serveur ou via des règles plus strictes.

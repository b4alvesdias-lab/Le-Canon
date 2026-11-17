# Le Canon V9 — architecture multijoueur

Cette branche est la base de travail V9. La branche `main` et le site GitHub Pages restent sur la V8.

## État réel

- V8 : création et accès aux salons vérifiés sur deux téléphones.
- V9 : couche Firestore de synchronisation isolée et durcie ; documentation du contrat et du plan d’intégration ajoutées.
- V9 n’est PAS encore jouable en ligne : le moteur V8 n’est pas encore connecté à cette couche.
- Les règles Firestore V9 sont un brouillon ; elles ne doivent pas être publiées.

## Schéma de travail V9

- `rooms/{code}/game/state` : état partagé (phase, saison, tour, météo, événement, scores, joueurs et joueur actif).
- `rooms/{code}/private/{uid}` : main et propositions de cartes visibles uniquement par leur propriétaire.
- `rooms/{code}/actions/{actionId}` : journal public des actions validées, sans cartes privées.
- `rooms/{code}/members/{uid}` : pseudo, présence et rôle, selon le schéma V8 existant.

Les mains, cartes spéciales et trois cartes de tour proposées ne doivent jamais être copiées dans l’état public.

## Fichiers importants

- `multiplayer-v9.js` : couche de synchronisation Firestore isolée. Elle vérifie l’appartenance au salon, réserve le lancement à l’hôte, contrôle la révision du tour et n’écoute que la main du joueur connecté.
- `docs/v9-integration-plan.md` : correspondance avec le moteur V8 et étapes d’intégration.
- `docs/firestore-rules-v9-draft.md` : brouillon de règles correspondant au nouveau schéma.
- `FIRESTORE_RULES_V9.txt` : ancien brouillon archivé, obsolète et à ne pas publier.

## Sécurité

Les règles Firestore et les transactions clientes peuvent isoler les mains et bloquer des écritures hors tour. Elles ne garantissent pas à elles seules l’intégrité des scores contre un client modifié. Pour une partie publique compétitive, les actions et calculs devront être validés par un backend de confiance.

## Prochaines étapes

1. Finaliser et tester les règles avec deux comptes anonymes.
2. Ajouter le lancement de partie par l’hôte et la configuration individuelle des joueurs.
3. Connecter le tirage privé, les tours, les cartes spéciales, les scores et la fin de partie.
4. Tester les déconnexions et conflits sur deux téléphones.
5. Publier seulement après validation, sans remplacer la V8 avant cela.

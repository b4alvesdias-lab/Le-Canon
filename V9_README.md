# Le Canon V9 — architecture multijoueur

Cette branche est la base de travail V9. La branche `main` et le site GitHub Pages restent sur la V8.

## État réel

- V8 : création et accès aux salons vérifiés sur deux téléphones.
- V9 : couche Firestore et adaptateur de données V8 ajoutés ; préparation individuelle, profils publics, mains privées, tirage privé lié à une révision et validation de carte proposée sont implémentés au niveau des modules.
- V9 n’est PAS encore jouable en ligne : `index.html` n’appelle pas encore l’adaptateur et les fonctions de préparation/tour. Les écrans, le calcul des scores synchronisé et les tests Firebase à deux comptes restent à faire.
- Les règles Firestore V9 sont un brouillon ; elles ne doivent pas être publiées.

## Schéma de travail V9

- `rooms/{code}/game/state` : état partagé (phase, saison, tour, météo, événement, scores, joueurs et joueur actif).
- `rooms/{code}/private/{uid}` : main et propositions de cartes visibles uniquement par leur propriétaire.
- `rooms/{code}/actions/{actionId}` : journal public des actions validées, sans cartes privées.
- `rooms/{code}/members/{uid}` : pseudo, présence et rôle, selon le schéma V8 existant.

Les mains, cartes spéciales et trois cartes de tour proposées ne doivent jamais être copiées dans l’état public.

## Fichiers importants

- `multiplayer-v9.js` : couche Firestore ; préparation individuelle, vérification des joueurs prêts, tirage privé persistant par révision, écoute de sa propre main et validation transactionnelle du tour.
- `multiplayer-v9-adapter.js` : convertit les objets du moteur V8 en profils publics, état partagé et paquets privés sans publier les mains.
- `docs/v9-integration-plan.md` : correspondance avec le moteur V8 et étapes d’intégration.
- `docs/firestore-rules-v9-draft.md` : brouillon de règles correspondant au nouveau schéma.
- `FIRESTORE_RULES_V9.txt` : ancien brouillon archivé, obsolète et à ne pas publier.

## Sécurité

Les règles Firestore et les transactions clientes peuvent isoler les mains et bloquer des écritures hors tour. Elles ne garantissent pas à elles seules l’intégrité des scores contre un client modifié. Pour une partie publique compétitive, les actions et calculs devront être validés par un backend de confiance.

## Prochaines étapes

1. Intégrer les modules aux écrans de salon et de préparation dans une copie V9 du moteur.
2. Brancher le lancement par l’hôte, le tirage privé, les tours et les cartes spéciales.
3. Synchroniser les scores, les corrections manuelles et la fin de partie.
4. Vérifier puis fusionner les règles Firestore avec les règles V8 ; tester les droits avec deux comptes anonymes.
5. Tester les déconnexions et conflits sur deux téléphones ; publier seulement après validation.

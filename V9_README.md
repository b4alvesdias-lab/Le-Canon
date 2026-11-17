# Le Canon V9 — architecture multijoueur

Cette branche est la base de travail V9. La branche `main` et le site GitHub Pages restent sur la V8.

## État réel

- V8 : création et accès aux salons vérifiés sur deux téléphones.
- V9 : couche Firestore et adaptateur de données V8 ajoutés ; préparation individuelle, profils publics, mains privées, tirage privé lié à une révision et validation de carte proposée sont implémentés au niveau des modules.
- V9 : le parcours complet a été validé dans deux navigateurs Playwright reliés aux émulateurs Firebase : création/rejoint du salon, préparation individuelle, carte spéciale, 8 tours, scores et podium final.
- CI : 7 tests de règles Firestore + 18 tests de modules/contrat + 1 test E2E complet réussis. Exécution : https://github.com/b4alvesdias-lab/Le-Canon/actions/runs/44199370631.
- V9 n’a pas encore été testée sur le vrai projet Firebase ni sur deux téléphones : les règles actives doivent d’abord être fusionnées avec le fragment V9. GitHub Pages reste volontairement sur V8.

## Schéma de travail V9

- `rooms/{code}/game/state` : état partagé (phase, saison, tour, météo, événement, scores, joueurs et joueur actif).
- `rooms/{code}/private/{uid}` : main et propositions de cartes visibles uniquement par leur propriétaire.
- `rooms/{code}/actions/{actionId}` : journal public des actions validées, sans cartes privées.
- `rooms/{code}/members/{uid}` : pseudo, présence et rôle, selon le schéma V8 existant.

Les mains, cartes spéciales et trois cartes de tour proposées ne doivent jamais être copiées dans l’état public.

## Fichiers importants

- `multiplayer-v9.js` : couche Firestore ; préparation individuelle, vérification des joueurs prêts, tirage privé persistant par révision, écoute de sa propre main et validation transactionnelle du tour.
- `multiplayer-v9-adapter.js` : convertit les objets du moteur V8 en profils publics, état partagé et paquets privés sans publier les mains.
- `multiplayer-v9-controller.js` : raccorde le salon, la préparation individuelle, les choix de tour, les cartes spéciales et les scores au moteur V8.
- `v9.html` : copie de test qui charge les modules V9 ; `index.html` reste la V8 sur cette branche.
- `docs/v9-integration-plan.md` : correspondance avec le moteur V8 et étapes d’intégration.
- `firestore.v9.rules` : règles de test complètes pour l’émulateur, avec des règles racine V8 simplifiées ; ne pas les publier.
- `FIRESTORE_V9_MERGE_FRAGMENT.txt` : fonctions et sous-chemins V9 à fusionner dans le ruleset V8 actif, sans remplacer les règles des salons.
- `docs/v9-live-deployment.md` : procédure guidée pour préparer le test sur le vrai projet Firebase.
- `docs/firestore-rules-v9-draft.md` : explication historique et avertissements sur la fusion des règles.
- `FIRESTORE_RULES_V9.txt` : ancien brouillon archivé, obsolète et à ne pas publier.

## Sécurité

Les règles Firestore et les transactions clientes peuvent isoler les mains et bloquer des écritures hors tour. Elles ne garantissent pas à elles seules l’intégrité des scores contre un client modifié. Pour une partie publique compétitive, les actions et calculs devront être validés par un backend de confiance.

## Prochaines étapes

1. Fusionner `FIRESTORE_V9_MERGE_FRAGMENT.txt` dans les règles V8 déjà publiées, sans remplacer les règles racine `rooms` et `members`.
2. Tester sur deux vrais téléphones avec deux comptes anonymes sur le projet Firebase `le-canon`.
3. Vérifier les rafraîchissements, retours arrière, reconnexions et déconnexions.
4. Publier `v9.html` et ses modules sur GitHub Pages après ces tests ; garder V8 accessible jusqu’à validation.

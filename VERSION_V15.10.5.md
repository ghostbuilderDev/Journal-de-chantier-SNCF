# Journal de chantier V15.10.5 — Actions du rapport

Archive de reprise de la V15.10.5, compatible avec l’installation interrompue ainsi qu’avec les V15.10.3 et V15.10.4. Le Rapport journalier affiche **V10.5**. Le correctif de numérotation V15.10.4 est inclus : il n’est pas nécessaire de l’installer séparément.

## Correction du blocage d’installation

Le journal GitHub de l’exécution 34537050638 indique que les tests ont réussi et que le contrôle du serveur a ensuite échoué. Le message initial ne précisait pas quel contrôle était refusé.

Un défaut a été reproduit dans les droits des anciennes fonctions d’archivage : un droit accordé directement au rôle `anon` pouvait subsister après le retrait des droits de `PUBLIC`. Le contrôle de finalisation des archives devenait alors faux. Ce cas est désormais couvert par les tests avec des droits hérités, conformément aux [règles de droits des fonctions Supabase](https://supabase.com/docs/guides/database/functions#function-privileges).

La reprise applique une petite migration distincte qui corrige uniquement les droits de ces fonctions. La migration de numérotation déjà enregistrée n’est pas rejouée. Les rapports, compteurs, numéros, PDF et signatures sont conservés. Aucun contrôle n’est contourné ; un éventuel autre défaut est désormais indiqué par son nom précis.

La valeur exacte des droits sur le serveur de production n’a pas pu être lue directement depuis cette session. Le correctif traite le défaut reproduit ; les contrôles nommés s’exécuteront à nouveau lors de l’installation.

## Utilisation

Un bouton bleu **Actions**, portant une icône de roue dentée, reste accessible dans chaque onglet du Rapport journalier. Le faire glisser avec le doigt ou la souris pour le repositionner. Sa position est mémorisée sur l’appareil et adaptée à l’espace disponible après rotation de l’écran.

Un appui ouvre **Actions du rapport** : transfert, enregistrement sur le serveur, validation, actualisation, sauvegarde en fichier, création du rapport suivant et historique. La sélection d’une commande ferme le menu et lance la fonction habituelle, avec ses contrôles et confirmations existants.

**Historique du rapport** se déplie dans cette même fenêtre. Le bouton **Fermer ×** permet de revenir à la saisie. Le menu ne crée pas de nouvel onglet et son ouverture, sa fermeture ou le déplacement du bouton ne modifient pas le rapport.

L’état de sauvegarde reste visible sous l’en-tête. Les problèmes d’enregistrement restent affichés et sont signalés sur le bouton Actions. Les droits d’accès, transferts, validations et sauvegardes utilisent les fonctions déjà présentes.

## Installation dans Termux

Télécharger `Journal-Chantier-V15.10.5-Reprise.zip`, puis exécuter :

```bash
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.10.5-Reprise.zip" -d "$HOME/Journal-Chantier-V15.10.5-Reprise"
bash "$HOME/Journal-Chantier-V15.10.5-Reprise/scripts/update-v15105-termux.sh"
```

L’installateur vérifie la version, sauvegarde le code existant, applique le correctif des droits manquant et fait contrôler la numérotation partagée par GitHub Actions, puis publie l’interface. Le contrôle du serveur garde le nom **V15.10.4 – numérotation des rapports** : c’est normal, cette partie est reprise dans la livraison V15.10.5.

Après la réussite de GitHub Actions et de GitHub Pages, fermer puis rouvrir le Journal et le Rapport journalier. Vérifier la mention **V10.5**. Ne pas effacer les données du navigateur.

Une installation V15.10.4 déjà réalisée est reconnue. Les migrations précédentes ne sont pas rejouées ; la numérotation et le correctif des droits ne sont appliqués que si leurs enregistrements respectifs manquent. En cas d’interruption, relancer la même commande. Des modifications locales inconnues ne sont pas écrasées.

Les rapports, signatures, photos, configurations et notifications existants sont conservés. La préparation de cette archive ne déploie pas automatiquement l’application.

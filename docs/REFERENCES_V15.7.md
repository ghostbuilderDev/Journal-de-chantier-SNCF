# Références CR off V15.7

Fichier source : Programmation AINM S37 à S44 04-09-2026.xlsx

SHA-256 : `77dd0a6e5ac879e3146f6c8a04c79feea77fc3f62a29e3bf409cc23aac5c79f2`

Le catalogue précédent n’était pas filtré par chantier. Il couvrait les 124 lignes au nom de Petit, Dahmani ou Damani. Les 11 lignes complémentaires de **Moret (Samois)** ajoutent 6 références caténaires et 5 ITC. Le catalogue contient désormais **64 intitulés : 14 SEL, 23 secteurs et 27 ZEP / groupements**.

Les intitulés groupés restent groupés. Les SEL 1 + 3 ou 27 + 29 + 161, par exemple, ne sont pas décomposées artificiellement. Les mentions « Précaire » sont conservées. Aucune relation SEL–secteur n’est inventée. Une note de coactivité et une cellule numérique inexploitable restent exclues.

Toutes ces suggestions sont accessibles depuis n’importe quel chantier autorisé. Le choix Type filtre uniquement SEL ou Secteur. La recherche ignore la casse et les accents ; les mots peuvent être saisis dans un ordre différent. Le champ peut rester vide, être saisi librement ou être modifié après sélection.

## Références ajoutées

| Type | Intitulé exact | Exemple de source |
|---|---|---|
| SEL | SEL 1 SR Samois - St Mammes V1 | WE 24-25!W5 |
| SEL | SEL 2 SR Samois - St Mammes V2 | WE 24-25!W5 |
| Secteur | SR Samois - St Mammes V1 | S19 AINM!W7 |
| Secteur | SR Samois - St Mammes V2 | S19 AINM!W7 |
| Secteur | SR St Melun- samois V1 | S19 AINM!W7 |
| Secteur | SR St Melun- samois V2 | S19 AINM!W7 |
| ZEP | Groupement ZEP Type G 701 +702 +703 | S19 AINM!V7 |
| ZEP | ZEP Type G 704 | S23 AINM!V7 |
| ZEP | ZEP Type G 704 (Précaire) | S19 AINM!V7 |
| ZEP | ZEP Type G 705 | S23 AINM!V7 |
| ZEP | ZEP Type G 705 (Précaire) | S19 AINM!V7 |

## Extraction reproductible

```sh
python scripts/extract-v157-references.py 'Programmation AINM S37 à S44 04-09-2026.xlsx'
```

Le fichier Excel est lu sans être modifié. `data/cr-references-v157.json` conserve les cellules sources de chaque suggestion.

# Références importées

Source : `Programmation AINM S37 à S44 04-09-2026.xlsx`, fourni avec la demande. Le classeur comporte également d’autres semaines : toutes ses feuilles ont été lues.

Les cellules R identifient le demandeur ; seules les lignes comportant le nom entier Petit ou Dahmani (variante Damani acceptée) sont retenues. S9 correspond à V, S11 à W ; chaque ligne de ces cellules devient un choix, sans découper arbitrairement les groupements. Le JSON `data/cr-references-v156.json` conserve les cellules et feuilles exactes, les libellés, les sites et les relations SEL/secteur explicites. Aucun numéro de téléphone n’est copié.

Les types « Secteur » incluent les groupes de secteurs et le feeder tel qu’il est mentionné dans S11 ; le libellé source reste visible. La ligne « 1bis + 3bis + 5bis + 11bis du Sr… » est proposée dans SEL selon la notation du fichier, sans modifier son périmètre. Une valeur numérique Excel isolée en S31 et les notes de coactivité sont listées comme exclusions dans le JSON.

Ces références sont des suggestions de saisie, pas une configuration de nuit ni une validation du périmètre réellement pris. Rien n’est choisi automatiquement.

La base privée reçoit les données par la migration V15.6 ; administrateurs et responsables affectés obtiennent uniquement les choix de la rubrique accessible. Les correspondances ne sont pas construites en croisant toutes les ZEP avec tous les SEL d’une ligne : cela créerait des liens non établis par le fichier.

Extraction reproductible, en lecture seule du classeur : `python scripts/extract-v156-references.py chemin/du/classeur.xlsx` (outil d’analyse Python `openpyxl` requis uniquement pour refaire l’extraction ; pas pour installer l’application).

/*
 * Référentiel de règlement observé dans le décompte n°04 PCLE du 12/08/2026.
 * Il complète le détail estimatif : les agents ne voient jamais ces données.
 * Formule Série 300 documentée : PU BPU × (1 + Maj./Min.) × CR.
 */
window.RJ_BILLING_EVIDENCE = {
  sourceLabel: "Décompte n°04 PCLE - commande 00410-0000002283 - 12/08/2026",
  sourceDate: "2026-08-12",
  sourcePeriod: "nuit semaine",
  series300Formula: "PU BPU × (1 + Maj./Min.) × CR",
  series300Profiles: {
    "24001.01": { defaultCr: 1.9, observedCrs: [1.9, 1.75] },
    "24001.02": { defaultCr: 1.9, observedCrs: [1.9] },
    "24050.01": { defaultCr: 1.9, observedCrs: [1.9] },
    "24050.02": { defaultCr: 1.9, observedCrs: [1.9] },
    "24051.01": { defaultCr: 1.9, observedCrs: [1.9] },
    "24051.02": { defaultCr: 1.9, observedCrs: [1.9, 1.75] },
    "24310.01": { defaultCr: 1.75, observedCrs: [1.75] },
    "24310.02": { defaultCr: 1.75, observedCrs: [1.75] },
    "24311.01": { defaultCr: 1.75, observedCrs: [1.75, 1.9] },
    "24311.02": { defaultCr: 1.75, observedCrs: [1.75, 1.9] },
    "24320.01": { defaultCr: 1.9, observedCrs: [1.9] },
    "24340.01": { defaultCr: 1.75, observedCrs: [1.75] },
    "24341.01": { defaultCr: 1.75, observedCrs: [1.75] },
    "29057.01": { defaultCr: 1.75, observedCrs: [1.75] },
    "29062.01": { defaultCr: 1.9, observedCrs: [1.9] },
    "29063.01": { defaultCr: 1.9, observedCrs: [1.9] },
    "29071.01": { defaultCr: 1.75, observedCrs: [1.75] },
    "36050": { defaultCr: 1.9, observedCrs: [1.9] },
    // Références BPU récurrentes non présentes dans ce décompte, mais utilisées
    // par les libellés terrain. Le CR par défaut suit le profil observé des CI / jonctions.
    "24321.01": { defaultCr: 1.9, observedCrs: [1.9], marketDefault: true },
    "29050.01": { defaultCr: 1.9, observedCrs: [1.9], marketDefault: true },
    "29050.02": { defaultCr: 1.9, observedCrs: [1.9], marketDefault: true },
    "29051.01": { defaultCr: 1.9, observedCrs: [1.9], marketDefault: true },
    "29051.02": { defaultCr: 1.9, observedCrs: [1.9], marketDefault: true },
  },
  /*
   * Réglages par défaut issus des postes effectivement facturés et de la règle
   * métier .01 = pose / .02 = dépose communiquée pour ce marché. Ils évitent
   * toute ligne « à qualifier » dans la saisie courante ; l’administrateur peut
   * toujours les modifier dans les réglages d’exception.
   */
  defaultMappings: {
    "intervalle-decharge": "24050.01",
    "connexion-95-7m": "24310.01",
    "connexion-240-7m": "24311.01",
    "ci-1500": "29050.01",
    "ci-25000": "29051.01",
    "deroulage-240": "PB2-47-2",
    "deroulage-95": "PB2-47-1",
    "majoration-cable-conduit-ferme": "PB2-49-1",
    "depose-cable-240-reemploi": "PB2-50-2",
    "depose-cable-95-reemploi": "PB2-50-1",
    "depose-cable-sans-reemploi-ciel-ouvert": "PB2-51-1",
    "depose-cable-sans-reemploi-conduit": "PB2-51-2",
    "bj-240": "24321.01",
    "bj-95": "24320.01",
    "cit-1400": "29050.01",
    "rvl-120": "24050.01",
    "emission-reception-cdv-birail": "24001.01",
  },
  manualRecords: [
    {
      source: "Décompte n°04 PCLE - 12/08/2026",
      sheet: "Décompte facturé",
      sourceRow: null,
      article: "36050",
      articleBase: "36050",
      description: "Pose et dépose d'une clôture limitative grillagée souple en polyéthylène (h=1 m) et de piquets, avec déplacement selon l'avancement.",
      unit: "ml",
      pricingFamily: "serie-300",
      timeVariant: null,
      timeRule: "nuit semaine - CR 1,9 observé dans le décompte",
      unitPriceHT: 4.7,
      coefficient: 0.65,
      contractualUnitPriceHT: 14.73,
    },
  ],
  billedTimeArticleBases: [
    "PB2-8-1", "PB2-16-1", "PB2-16-2", "PB2-18-1", "PB2-19-1", "PB2-19-2",
    "PB2-23-5", "PB2-23-6", "PB2-24-3", "PB2-27-1", "PB2-30-1",
    "PB2-30-4", "PB2-30-5", "PB2-30-6", "PB2-34-1", "PB2-34-2", "PB2-35-1",
    "PB2-35-2", "PB2-41-1", "PB2-47-1", "PB2-47-2", "PB2-49-1", "PB2-51-1",
    "PB2-52-1", "PB2-52-2", "PB2-53-1", "PB2-53-2", "PB2-61-1", "PB2-62-2",
    "PB2-64-4", "PB2-70-1",
  ],
  billedTimeVariant: "N2",
  // Montants unitaires HT N2 lus dans le décompte facturé. Le catalogue BPU
  // reste la source de calcul applicative ; cette liste permet l'audit direct
  // des 31 postes réellement utilisés par l'entreprise sur ce décompte.
  billedTimeRecords: [
    ["PB2-8-1", 1472.50], ["PB2-16-1", 41.06], ["PB2-16-2", 108.26], ["PB2-18-1", 38.48], ["PB2-19-1", 31.88], ["PB2-19-2", 16.28],
    ["PB2-23-5", 2127.85], ["PB2-23-6", 356.12], ["PB2-24-3", 5160.61], ["PB2-27-1", 727.53], ["PB2-30-1", 161.50], ["PB2-30-4", 27.23],
    ["PB2-30-5", 30.76], ["PB2-30-6", 247.06], ["PB2-34-1", 1482.00], ["PB2-34-2", 148.20], ["PB2-35-1", 1691.00], ["PB2-35-2", 161.50],
    ["PB2-41-1", 206.32], ["PB2-47-1", 2.58], ["PB2-47-2", 6.76], ["PB2-49-1", 5.30], ["PB2-51-1", 2281.08], ["PB2-52-1", 1.46],
    ["PB2-52-2", 18.64], ["PB2-53-1", 139.57], ["PB2-53-2", 106.93], ["PB2-61-1", 24.17], ["PB2-62-2", 528.94], ["PB2-64-4", 9.69],
    ["PB2-70-1", 7.24],
  ],
  billedSeries300Articles: [
    "24001.01", "24001.02", "24050.01", "24050.02", "24051.01", "24051.02",
    "24310.01", "24310.02", "24311.01", "24311.02", "24320.01", "24340.01",
    "24341.01", "29057.01", "29062.01", "29063.01", "29071.01", "36050",
  ],
  billedAdminArticleBases: ["PB1-1-1", "PB1-1-2", "PB1-2-1", "PB1-3-1", "PB1-3-2", "PB1-3-3", "PB1-3-4", "PB1-6-1"],
  billedAdminArticles: ["PB1-1-1", "PB1-1-2", "PB1-2-1", "PB1-3-1 J", "PB1-3-2 N", "PB1-3-2 J", "PB1-3-3 J", "PB1-3-4 J", "PB1-6-1 W"],
};

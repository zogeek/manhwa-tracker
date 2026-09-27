// Style des boutons en pied de `ManhwaCard` (Ajouter, Importer, Voir la fiche).
// Le bouton shadcn est `whitespace-nowrap` + hauteur fixe : sur une carte étroite (2 colonnes
// sur mobile), un libellé long débordait. Ici : pleine largeur, retour à la ligne autorisé et
// hauteur minimale (le bouton grandit au lieu de rogner son texte).
// Module neutre (ni serveur ni client) : importable par les deux.
export const CARD_ACTION_CLASS = "h-auto min-h-8 w-full whitespace-normal py-1.5 text-center leading-tight text-balance";

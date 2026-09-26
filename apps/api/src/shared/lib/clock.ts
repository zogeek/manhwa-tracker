/** Horloge injectable (millisecondes) : les tests avancent le temps sans `setTimeout`. */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

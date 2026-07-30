import seedrandom from "seedrandom";

export function makeRng(seed: string | number) {
  const rng = seedrandom(String(seed));
  return {
    /** [0, 1) */
    next: () => rng(),
    /** [min, max) integer */
    int: (min: number, max: number) => Math.floor(rng() * (max - min)) + min,
    /** pick one element */
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!,
    /** Gaussian-ish via central limit; mean 0, stddev ~1 */
    normal: () => {
      let s = 0;
      for (let i = 0; i < 6; i++) s += rng();
      return s - 3;
    },
  };
}

export type Rng = ReturnType<typeof makeRng>;

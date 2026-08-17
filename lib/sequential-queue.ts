/** Run user-selected files one at a time and publish every committed result.
 * If item N fails, callers still retain state from items 1..N-1. */
export async function runSequentially<T, I>(
  initial: T,
  items: I[],
  work: (state: T, item: I) => Promise<T>,
  onProgress: (state: T) => void
): Promise<T> {
  let state = initial;
  for (const item of items) {
    state = await work(state, item);
    onProgress(state);
  }
  return state;
}

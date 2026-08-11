// Ingatan task provider — seam agar provider tetap BUTA terhadap database.
//
// lib/providers/stubs/* sengaja tidak pernah mengimpor `pg`: mereka dipakai
// juga di unit test dan di jalur dev SQLite. Jadi implementasi nyatanya
// dipasang oleh worker saat start (lihat lib/postgres/task-memo.ts), dan
// bawaannya no-op — kalau tidak ada yang memasang, perilakunya persis seperti
// sebelum fitur ini ada.

export interface TaskMemo {
  /** id task yang masih layak dilanjutkan, atau null. */
  get(jobId: string, shotIndex: number, provider: string): Promise<string | null>;
  put(jobId: string, shotIndex: number, provider: string, taskId: string): Promise<void>;
  /** Dipanggil setelah job selesai — agar tabel tidak menumpuk dan tidak ada
   * task basi yang bisa terpakai ulang. */
  clear(jobId: string): Promise<void>;
}

const NOOP: TaskMemo = {
  async get() { return null; },
  async put() {},
  async clear() {},
};

let impl: TaskMemo = NOOP;

export function setTaskMemo(memo: TaskMemo): void { impl = memo; }
export function taskMemo(): TaskMemo { return impl; }

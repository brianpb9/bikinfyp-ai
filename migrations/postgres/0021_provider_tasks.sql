-- Ingatan task provider (masukan tester #10a, 2026-08-11).
--
-- KEBOCORAN BIAYA YANG DITUTUP: id task BytePlus sebelumnya hanya hidup di
-- memori selama satu panggilan generate(). Kalau worker mati di antara submit
-- dan polling selesai, id itu hilang bersama prosesnya — percobaan berikutnya
-- memanggil createTask() lagi, dan BytePlus menagih DUA KALI untuk shot yang
-- sama. findReusableClips() tidak menolong di kasus ini karena berkasnya
-- memang belum pernah selesai diunduh.
--
-- Dengan tabel ini, percobaan ulang MELANJUTKAN polling task lama alih-alih
-- mengirim yang baru.
CREATE TABLE IF NOT EXISTS provider_tasks (
  job_id TEXT NOT NULL REFERENCES jobs(id),
  shot_index INTEGER NOT NULL,
  provider TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, shot_index, provider)
);
CREATE INDEX IF NOT EXISTS idx_provider_tasks_job ON provider_tasks(job_id);

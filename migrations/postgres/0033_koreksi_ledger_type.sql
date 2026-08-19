-- TIPE LEDGER "koreksi" — pembalikan yang JUJUR, bukan penghapusan.
--
-- Sebabnya konkret: 19 Agu 2026 satu callback SANDBOX Duitku mengkredit
-- Rp60.000 sungguhan ke dompet produksi (order racun-9f1b7d04-18dbf97f-2c35).
-- Uang mainan yang menjadi saldo nyata adalah lubang akuntansi, dan ia harus
-- ditutup dengan cara yang bisa diperiksa orang lain bertahun-tahun kemudian.
--
-- KENAPA BUKAN MENGHAPUS/MENGUBAH BARIS TOPUP-nya. credit_ledger append-only
-- (trigger credit_ledger_no_update, migrasi 0002), dan itu bukan formalitas:
-- saldo adalah AGREGAT ledger, jadi baris yang bisa diedit berarti saldo yang
-- bisa ditulis ulang tanpa jejak. Mematikan trigger untuk "sekali ini saja"
-- adalah persis kebiasaan yang membuat catatan uang berhenti bisa dipercaya.
--
-- KENAPA BUKAN MEMAKAI TIPE YANG SUDAH ADA. 'release' berarti refund hold job
-- (delta positif, punya job_id); memakainya untuk memotong saldo akan membuat
-- setiap laporan refund berbohong. Pembalikan butuh namanya sendiri supaya
-- bisa dihitung, dikecualikan, dan dijelaskan.
--
-- Tanpa DEFAULT dan tanpa penulis otomatis: satu-satunya yang menulis 'koreksi'
-- adalah skrip operasi dengan alasan tertulis (scripts/koreksi-kredit-sandbox.mjs).

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_type_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_type_check
  CHECK (type IN ('topup','hold','capture','release','bonus','regen','koreksi'));

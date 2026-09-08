-- JATAH VIDEO PER JENIS UNTUK ORGANISASI — menyamakan brand dengan retail.
--
-- ---------------------------------------------------------------------------
-- KENAPA
-- ---------------------------------------------------------------------------
-- Brian menemukannya 9 Sep 2026: top-up brand masih memakai RUPIAH lewat
-- credit_ledger (hold/capture/release), sementara retail sudah pindah ke JATAH
-- VIDEO PER JENIS lewat kredit_video (standard/premium/ultra).
--
-- Dua sistem uang untuk satu produk berarti dua tempat yang bisa menyimpang,
-- dua cara menghitung sisa, dan dua penjelasan berbeda kepada pelanggan yang
-- menanyakan hal yang sama. Yang lebih buruk: brand tidak bisa diberi tahu
-- "sisa 5 video standard" — hanya "sisa Rp75.000", angka yang tidak menjawab
-- pertanyaan yang sebenarnya ia punya.
--
-- ---------------------------------------------------------------------------
-- POLA KEPEMILIKAN MENGIKUTI credit_ledger, BUKAN MENCIPTAKAN YANG BARU
-- ---------------------------------------------------------------------------
--   retail : user_id = pemilik,        org_id IS NULL
--   org    : user_id = anggota pelaku, org_id = organisasinya
--
-- user_id TETAP diisi untuk baris org: itu jejak audit siapa yang membelanjakan
-- jatah bersama. Saldo dibaca lewat org_id.
--
-- SYARAT "org_id IS NULL" PADA KUERI RETAIL WAJIB ADA. Tanpa itu, anggota yang
-- juga punya organisasi akan melihat jatah pribadinya KETAMBAHAN jatah org —
-- bug yang persis pernah terjadi pada credit_ledger (lihat catatan CreditOwner
-- di lib/credits.ts) dan tidak perlu diulang di tabel kedua.
ALTER TABLE kredit_video ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX idx_kredit_video_org ON kredit_video(org_id, jenis) WHERE org_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- SALDO RUPIAH YANG SUDAH ADA DIPINDAHKAN, BUKAN DIHAPUS
-- ---------------------------------------------------------------------------
-- Tiga organisasi aktif memegang total Rp1.040.000 saat migrasi ini ditulis.
-- Itu milik pelanggan; ia harus muncul lagi sebagai jatah video, bukan menguap.
--
-- Dikonversi pada harga tier STANDARD karena itu menghasilkan jumlah video
-- TERBANYAK — kalau kami harus salah, lebih baik salah ke arah yang
-- menguntungkan pemegang saldo. Brian bisa menata ulang komposisinya lewat
-- tombol top-up admin yang sekarang memberi jatah per jenis.
--
-- Sisa di bawah satu video tidak bisa diwakili sistem jatah dan memang hilang;
-- besarnya < Rp15.000 per organisasi, dan dicatat di kolom catatan supaya bisa
-- ditelusuri kalau ada yang bertanya.
--
-- credit_ledger TIDAK dihapus (append-only, trigger menolaknya) melainkan
-- DINETRALKAN dengan baris lawan. Kalau tidak, saldo yang sama akan terbaca di
-- dua tempat dan bisa dibelanjakan dua kali.
DO $$
DECLARE
  r RECORD;
  harga INTEGER;
  jatah INTEGER;
  sisa_rp INTEGER;
  owner_id TEXT;
  t TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT harga_idr INTO harga FROM harga_kredit_video WHERE jenis = 'standard' AND aktif LIMIT 1;
  IF harga IS NULL OR harga <= 0 THEN
    RAISE EXCEPTION 'harga standard tidak ditemukan — konversi dibatalkan supaya tidak menebak nilai uang';
  END IF;

  FOR r IN
    SELECT o.id, o.name, COALESCE(SUM(c.delta), 0)::INTEGER AS saldo
    FROM organizations o JOIN credit_ledger c ON c.org_id = o.id
    GROUP BY o.id, o.name HAVING COALESCE(SUM(c.delta), 0) > 0
  LOOP
    SELECT m.user_id INTO owner_id FROM org_members m
      WHERE m.org_id = r.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1;
    IF owner_id IS NULL THEN
      SELECT m.user_id INTO owner_id FROM org_members m WHERE m.org_id = r.id ORDER BY m.created_at LIMIT 1;
    END IF;
    CONTINUE WHEN owner_id IS NULL;

    jatah   := r.saldo / harga;
    sisa_rp := r.saldo - (jatah * harga);

    IF jatah > 0 THEN
      INSERT INTO kredit_video (id, user_id, org_id, jenis, ember, delta, tipe, catatan, dibuat_pada)
      VALUES (gen_random_uuid()::TEXT, owner_id, r.id, 'standard', 'topup', jatah, 'bonus',
              format('migrasi 0041: Rp%s -> %s video standard (sisa Rp%s tidak terwakili)',
                     r.saldo, jatah, sisa_rp), t);
    END IF;

    INSERT INTO credit_ledger (id, user_id, org_id, delta, type, job_id, payment_id, created_at)
    VALUES (gen_random_uuid()::TEXT, owner_id, r.id, -r.saldo, 'bonus', NULL, NULL, t);

    INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at)
    VALUES (gen_random_uuid()::TEXT, 'migrasi:0041', 'kredit.konversi', 'organizations', r.id,
            json_build_object('saldo_idr', r.saldo, 'harga_standard', harga,
                              'jatah_standard', jatah, 'sisa_idr', sisa_rp)::TEXT, t);
  END LOOP;
END $$;

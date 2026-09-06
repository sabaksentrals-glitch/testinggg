# testinggg

BIOFLOG · Sabak Sentral — operasional farm bioflok.

- GitHub: [sabaksentrals-glitch/testinggg](https://github.com/sabaksentrals-glitch/testinggg)
- Database: Neon Postgres **Testingg2** (org SABAK SENTRAL, `aws-ap-southeast-1`, Postgres 18)
  - Project ID: `empty-bonus-99002446`
  - Branch default: `br-dawn-wildflower-b3dz448b` · database `neondb` · role `neondb_owner`
  - Database baru & kosong: hanya `_migrations` + `bioflog_state` dari `migrations/`.
    Aplikasi menyemai data demo di memori pada load pertama dan menuliskan snapshot ke
    Neon begitu ada aksi pertama (lihat `queueSave` di `src/lib/bioflog/store.ts`).

Ledger kolam, siklus, pakan, kualitas air, dan tugas tersimpan di Neon. Pratinjau tanpa `DATABASE_URL` memakai PGLite lokal.

Akun demo (password sama): `admin@bioflog.local` · `BioflogDemo12`

## Koneksi database

`src/lib/db.ts` memilih backend dari `DATABASE_URL`: terisi → Neon (driver `pg`), kosong → PGLite embedded. Tidak ada perubahan kode saat berpindah.

Connection string berisi password, jadi **tidak pernah** di-commit. Ambil dari
[Neon Console](https://console.neon.tech) → project `Testingg2` → **Connect**, lalu simpan:

```sh
mkdir -p .local
printf '%s' 'postgresql://neondb_owner:<password>@ep-late-mouse-b3w4czf5-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require' > .local/database-url
chmod 600 .local/database-url
```

`.local/` dan `.env` sudah ada di `.gitignore`. `startup.sh` membaca `.local/database-url`
dan meng-export `DATABASE_URL` sebelum `npm run dev`; untuk menjalankan manual:

```sh
DATABASE_URL="$(cat .local/database-url)" npm run dev
```

Untuk deploy, set `DATABASE_URL` sebagai environment variable di platform (bukan di repo).

Skema berasal dari `migrations/*.sql` dan dipakai kedua backend. `npm run build` menjalankan
`scripts/migrate.mjs`, yang menerapkan file yang belum tercatat di tabel `_migrations` —
idempoten, aman diulang.

> Catatan: `.grok/app-env.json` menyetel `VITE_AUTH_ENABLED=false`. Aplikasi BIOFLOG memakai
> sesi sendiri (tabel `users`/`sessions`), tetapi helper Better Auth di `src/lib/auth/verify.server.ts`
> sengaja fail-closed saat `DATABASE_URL` aktif dengan flag itu — nyalakan `VITE_AUTH_ENABLED`
> bila nanti ada rute yang memakai `requireUserId()`.

# testinggg

BIOFLOG · Sabak Sentral — operasional farm bioflok.

- GitHub: [sabaksentrals-glitch/testinggg](https://github.com/sabaksentrals-glitch/testinggg)
- Database: Neon Postgres **testinggg** (org SABAK SENTRAL, `aws-ap-southeast-1`, Postgres 18)
  - Project ID: `odd-cherry-79935792`
  - Branch default: `br-tiny-mountain-b3jiz0i2` · database `neondb` · role `neondb_owner`

Ledger kolam, siklus, pakan, kualitas air, dan tugas tersimpan di Neon. Pratinjau tanpa `DATABASE_URL` memakai PGLite lokal.

Akun demo (password sama): `admin@bioflog.local` · `BioflogDemo12`

## Koneksi database

`src/lib/db.ts` memilih backend dari `DATABASE_URL`: terisi → Neon (driver `pg`), kosong → PGLite embedded. Tidak ada perubahan kode saat berpindah.

Connection string berisi password, jadi **tidak pernah** di-commit. Ambil dari
[Neon Console](https://console.neon.tech) → project `testinggg` → **Connect**, lalu simpan:

```sh
mkdir -p .local
printf '%s' 'postgresql://neondb_owner:<password>@ep-gentle-star-b3hu04ya-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require' > .local/database-url
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

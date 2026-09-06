# testinggg

BIOFLOG · Sabak Sentral — operasional farm bioflok.

- GitHub: [sabaksentrals-glitch/testinggg](https://github.com/sabaksentrals-glitch/testinggg)
- Database: Neon Postgres **testinggg** (ap-southeast-1)

Ledger kolam, siklus, pakan, kualitas air, dan tugas tersimpan di Neon.

Untuk development lokal tanpa `DATABASE_URL`, aplikasi dapat memakai PGLite. Pada deployment Vercel, aplikasi harus memakai Neon melalui `DATABASE_URL`; jika koneksi database production tidak tersedia, aplikasi berhenti secara eksplisit dan tidak fallback ke data demo.

Akun demo untuk pratinjau lokal/PGLite (password sama): `admin@bioflog.local` · `BioflogDemo12`

> **Peringatan keamanan.** Password di atas adalah kredensial demo dan bersifat publik.
> Akun pada database produksi saat ini masih memakai hash yang sama, jadi password
> tersebut harus diganti sebelum aplikasi dipakai untuk data sungguhan. Sejak
> perbaikan ini, aplikasi tidak lagi memaksakan password demo pada backend Neon —
> hash yang tersimpan dibiarkan apa adanya sehingga penggantian password bisa bertahan.

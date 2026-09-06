# testinggue

BIOFLOG · Sabak Sentral — operasional farm bioflok.

- GitHub: [sabaksentrals-glitch/testinggg](https://github.com/sabaksentrals-glitch/testinggg)
- Database: Neon Postgres **BIOFLOG Sabak Sentral** (ap-southeast-1)

Ledger kolam, siklus, pakan, kualitas air, dan tugas tersimpan di Neon. Pratinjau tanpa `DATABASE_URL` memakai PGLite lokal.

Akun demo untuk pratinjau lokal/PGLite (password sama): `admin@bioflog.local` · `BioflogDemo12`

> **Peringatan keamanan.** Password di atas adalah kredensial demo dan bersifat publik.
> Akun pada database produksi saat ini masih memakai hash yang sama, jadi password
> tersebut harus diganti sebelum aplikasi dipakai untuk data sungguhan. Sejak
> perbaikan ini, aplikasi tidak lagi memaksakan password demo pada backend Neon —
> hash yang tersimpan dibiarkan apa adanya sehingga penggantian password bisa bertahan.

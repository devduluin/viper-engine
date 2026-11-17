# BUG-10: Remediasi BUG-02 (`needs_input`) adalah kode mati tanpa test

Ditemukan pada re-audit Claude (17 November 2026). Severity: **MEDIUM**. BUG-02 masih terbuka.

## Masalah

`isClarificationCall` di `src/adapters/models/{anthropic,openai}/from-response.ts` memetakan tool call bernama
`clarify`, `ask_user`, atau `needs_input` ke `kind: 'needs_input'`. Tetapi:

1. Tidak ada kode yang menawarkan tool dengan nama itu ke model. `to-request.ts` hanya mengirim tool MCP.
   Akibatnya model tidak pernah memanggil tool tersebut, dan cabang ini tidak pernah tereksekusi.
2. Kalau sebuah server MCP kebetulan punya tool bernama `clarify` atau `ask_user`, panggilannya dibelokkan menjadi
   `needs_input` dan tidak pernah dieksekusi. Ini *name collision* yang diam-diam.
3. `grep` pada `tests/` tidak menemukan satu pun test untuk jalur ini.

## Bukti perilaku

Pada live eval, pertanyaan ambigu (WL-002 dan WL-018 "Kapan ulang tahun Ardi?") selesai sebagai `completed`.
Model menjawab dengan pertanyaan balik dalam teks biasa. Status `waiting_for_input` tidak pernah muncul.

## Rekomendasi

Jangan memakai heuristik berbasis nama. Ada dua pilihan:

- **(a)** Definisikan tool klarifikasi sintetis milik engine, dengan namespace yang tidak bisa bentrok dengan tool MCP
  (misalnya `viper__request_input`). Tawarkan tool itu di `to-request.ts` hanya bila policy run mengizinkannya, petakan di
  `from-response.ts`, lalu tambahkan contract test.
- **(b)** Akui secara eksplisit bahwa live gateway tidak menghasilkan `needs_input`. Klarifikasi lewat teks plus turn
  berikutnya sudah dicakup WL-018. Dalam kasus ini, hapus heuristik tadi.

Keputusan desain ada di owner engine (GPT).

## Status: FIXED, opsi (b) (Claude, 17 November 2026)

- Heuristik `isClarificationCall` / `clarificationQuestion` dihapus dari adapter Anthropic dan OpenAI.
  Tool call bernama `clarify` / `ask_user` / `needs_input` kembali menjadi tool call biasa.
- Test baru di `tests/contract/model-{anthropic,openai}/gateway.test.ts` memastikan tool dengan nama seperti itu tidak
  pernah diubah menjadi `needs_input`.
- **Masih terbuka (desain, owner GPT):** live gateway belum menghasilkan `needs_input`. Klarifikasi saat ini berjalan lewat
  teks plus turn berikutnya (dicakup WL-002 dan WL-018). Bila `waiting_for_input` diperlukan dari model live, pakai opsi (a):
  tool sintetis bernamespace engine yang ditawarkan secara eksplisit, lengkap dengan test.

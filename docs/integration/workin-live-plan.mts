// P07-04 live ablation for workin-live: one GENERIC host checklist (same for every case, written before
// any run and containing no dataset answers), installed through the opt-in `createPlanEvidence` seam.
// The runner switches it per run (VARIANTS=baseline,checklist) so both variants share model, data and tools.
import { createHash } from 'node:crypto';

export const WORKIN_CHECKLIST = Object.freeze({
  schemaVersion: 1, planId: 'workin-hr-checklist', revision: 1,
  objective: 'Jawab pertanyaan HR pengguna hanya berdasarkan hasil tool Workin.',
  steps: [
    { id: 'scope', goal: 'Tentukan karyawan, tanggal atau rentang tanggal, dan data apa yang diminta.',
      evidence: 'Pertanyaan pengguna; minta klarifikasi bila nama atau tanggal ambigu.', dependsOn: [] },
    { id: 'lookup', goal: 'Panggil tool Workin yang sesuai untuk setiap hari atau karyawan yang dibutuhkan; jangan menebak bagian yang belum dicek.',
      evidence: 'Hasil tool yang berhasil untuk setiap bagian data.', dependsOn: ['scope'] },
    { id: 'verify', goal: 'Gabungkan hasil dan cek ulang hitungan (jumlah hari, menit, rata-rata) terhadap hasil tool.',
      evidence: 'Setiap angka dapat ditelusuri ke hasil tool.', dependsOn: ['lookup'] },
    { id: 'answer', goal: 'Jawab ringkas dan sebutkan data yang tidak tersedia atau gagal diambil.',
      evidence: 'Jawaban akhir yang hanya memuat fakta dari hasil tool.', dependsOn: ['verify'] },
  ],
});

export const CHECKLIST_SHA256 = createHash('sha256').update(JSON.stringify(WORKIN_CHECKLIST)).digest('hex');

export type Variant = 'baseline' | 'checklist';

export function parseVariants(raw: string | undefined): Variant[] {
  const variants = (raw ?? 'baseline').split(',').map((v) => v.trim()).filter(Boolean);
  if (variants.length === 0 || variants.some((v) => v !== 'baseline' && v !== 'checklist') || new Set(variants).size !== variants.length) {
    throw new RangeError('VARIANTS must be baseline, checklist or baseline,checklist');
  }
  return variants as Variant[];
}

/** Alternate the order per trial so neither variant always runs first (warm caches, drift). */
export const variantOrder = (variants: Variant[], trial: number) => (trial % 2 === 0 ? [...variants].reverse() : variants);

type Provider = (request: { scope: unknown; conversationId: unknown; runId: unknown }, options: { signal: AbortSignal }) => Promise<readonly unknown[]>;

/**
 * Engine `contextEvidence`: returns the checklist only while `active()` is true, bound per run with the
 * real seam (exact scope/conversation/run). Baseline runs get no evidence at all.
 */
export function switchableChecklist(createPlanEvidence: (binding: unknown, plan: unknown) => Provider, active: () => boolean): Provider {
  const perRun = new Map<string, Provider>();
  return async (request, options) => {
    if (!active()) return [];
    const key = String(request.runId);
    let provider = perRun.get(key);
    if (provider === undefined) {
      provider = createPlanEvidence({ scope: request.scope, conversationId: request.conversationId, runId: request.runId }, WORKIN_CHECKLIST);
      perRun.set(key, provider);
    }
    return provider(request, options);
  };
}

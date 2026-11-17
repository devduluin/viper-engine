import type { TrustedScope } from '../../contracts/identity/scope.js';
import { assertTrustedScope } from '../../contracts/identity/scope.js';
import type { Clock, IdGenerator } from '../../contracts/identity/ports.js';
import { parseId } from '../../contracts/identity/ids.js';
import { requireState } from '../../contracts/api/failure.js';
import type { LearningStore, FeedbackInput, ProposalInput, ProposalReview } from '../../contracts/learning/ports.js';
import { feedbackInput, proposalInput, proposalReview } from '../../contracts/learning/validation.js';
import { recallLimit } from '../../contracts/recall/validation.js';

/** Explicit authenticated host operations. No model, background promotion or execution authority. */
export class EngineLearning {
  constructor(private readonly store: LearningStore, private readonly clock: Clock, private readonly ids: IdGenerator) {}
  async feedback(scope: TrustedScope, runId: string) {
    assertTrustedScope(scope); return requireState(await this.store.feedback(scope, parseId('run', runId)));
  }
  async recordFeedback(scope: TrustedScope, input: FeedbackInput) {
    assertTrustedScope(scope); return requireState(await this.store.recordFeedback(scope, feedbackInput(input), this.clock.now()));
  }
  async propose(scope: TrustedScope, input: ProposalInput) {
    assertTrustedScope(scope); return requireState(await this.store.propose(scope, this.ids.next('proposal'), proposalInput(input), this.clock.now()));
  }
  async getProposal(scope: TrustedScope, id: string) {
    assertTrustedScope(scope); return requireState(await this.store.get(scope, parseId('proposal', id)));
  }
  async proposals(scope: TrustedScope, runId: string, limit = 20) {
    assertTrustedScope(scope); return requireState(await this.store.list(scope, parseId('run', runId), recallLimit(limit)));
  }
  async review(scope: TrustedScope, id: string, input: ProposalReview) {
    assertTrustedScope(scope); return requireState(await this.store.review(scope, parseId('proposal', id), proposalReview(input), this.ids.next('note'), this.clock.now()));
  }
  async changes(scope: TrustedScope, id: string, limit = 20) {
    assertTrustedScope(scope); return requireState(await this.store.changes(scope, parseId('proposal', id), recallLimit(limit)));
  }
}

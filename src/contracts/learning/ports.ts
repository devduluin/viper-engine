import type { TrustedScope } from '../identity/scope.js';
import type { NoteSource, RecallPage } from '../recall/ports.js';
import type { StateResult } from '../state/result.js';

export type FeedbackVerdict = 'confirmed' | 'disputed';
export interface OutcomeFeedback {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly revision: number;
  readonly verdict: FeedbackVerdict;
  readonly source: NoteSource;
  readonly createdAt: number;
}
export interface FeedbackInput {
  readonly runId: string;
  /** Zero means no prior feedback. Revisions otherwise start at one. */
  readonly expectedRevision: number;
  readonly verdict: FeedbackVerdict;
  readonly source: NoteSource;
}
export interface ProposalInput {
  readonly runId: string;
  readonly feedbackRevision: number;
  readonly text: string;
}
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';
export interface MemoryProposal {
  readonly schemaVersion: 1;
  readonly proposalId: string;
  readonly revision: number;
  readonly status: ProposalStatus;
  readonly trust: 'unverified_proposal';
  readonly runId: string;
  readonly conversationId: string;
  readonly feedbackRevision: number;
  readonly finalMessageId: string;
  readonly text: string;
  readonly digest: string;
  readonly evidenceDigest: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Accepted notes remain user_asserted; acceptance does not prove a world fact. */
  readonly noteId?: string;
  readonly noteRevision?: number;
  readonly confirmation?: NoteSource;
}
export interface ProposalReview {
  readonly expectedRevision: number;
  readonly digest: string;
  readonly decision: 'accept' | 'reject';
  /** Accept requires a new owned user statement containing the exact candidate text. */
  readonly confirmation?: NoteSource;
}
export interface ProposalChange {
  readonly revision: number;
  readonly status: ProposalStatus;
  readonly at: number;
  readonly noteId?: string;
}
export interface LearningStore {
  feedback(scope: TrustedScope, runId: string): Promise<StateResult<OutcomeFeedback>>;
  recordFeedback(scope: TrustedScope, input: FeedbackInput, at: number): Promise<StateResult<OutcomeFeedback>>;
  propose(scope: TrustedScope, id: string, input: ProposalInput, at: number): Promise<StateResult<MemoryProposal>>;
  get(scope: TrustedScope, id: string): Promise<StateResult<MemoryProposal>>;
  list(scope: TrustedScope, runId: string, limit: number): Promise<StateResult<RecallPage<MemoryProposal>>>;
  review(scope: TrustedScope, id: string, input: ProposalReview, noteId: string, at: number): Promise<StateResult<MemoryProposal>>;
  changes(scope: TrustedScope, id: string, limit: number): Promise<StateResult<RecallPage<ProposalChange>>>;
}

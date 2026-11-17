import type { ContentBlock } from '../messages/content.js';
import type { ProposalView } from './views.js';

export interface UserInputView { readonly content: readonly ContentBlock[] }
export interface ContextSelectionView {
  readonly resources?: readonly { readonly connectionId: string; readonly uri: string }[];
  readonly prompts?: readonly { readonly connectionId: string; readonly name: string; readonly arguments?: Readonly<Record<string, string>> }[];
}
export interface StartRunView { readonly input: UserInputView; readonly context?: ContextSelectionView }
export interface SubmitInputView { readonly inputId: string; readonly expectedRevision: number; readonly input: UserInputView }
export interface DecideApprovalView { readonly expectedRevision: number; readonly proposal: ProposalView; readonly decision: 'accept' | 'reject' }

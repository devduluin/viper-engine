import type { Message } from '../../contracts/messages/message.js';

export function questionText(message: Message): string {
  const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  return text.length <= 65536 ? text : `${text.slice(0, 65480)}\n[Question continues in conversation history]`;
}

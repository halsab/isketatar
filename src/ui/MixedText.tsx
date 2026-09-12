import { ArabicText } from './ArabicText';

export function MixedText({ text }: { text: string }) {
  return text.split(/([\p{Script=Arabic}\p{M}\u200c\u200d]+(?:[\s/،؛؟]+[\p{Script=Arabic}\p{M}\u200c\u200d]+)*)/u).map((part, index) => /\p{Script=Arabic}/u.test(part) ? <ArabicText key={index}>{part}</ArabicText> : part);
}

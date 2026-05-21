import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export type ContentBlock = { type: 'text'; text: string };

export function buildPrompt(text: string, filePaths?: string[]): ContentBlock[] {
  let fullText = '';

  if (filePaths && filePaths.length > 0) {
    const fileContents = filePaths.map((filePath) => {
      const content = readFileSync(filePath, 'utf-8');
      const name = basename(filePath);
      return `<file path="${name}">\n${content}\n</file>`;
    });
    fullText = fileContents.join('\n\n') + '\n\n---\n\n' + text;
  } else {
    fullText = text;
  }

  return [{ type: 'text', text: fullText }];
}

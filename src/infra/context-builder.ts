import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isTemplateOnly, readMemoryFile } from '../config.js';

export function buildInitialContext(workDir: string): string[] {
  const files: string[] = [];
  const dirs = [join(workDir, 'knowledge'), join(workDir, 'memory')];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          files.push(join(dir, entry));
        }
      }
    } catch {}
  }

  // Scan skills/*/SKILL.md
  const skillsDir = join(workDir, 'skills');
  if (existsSync(skillsDir)) {
    try {
      const skillFolders = readdirSync(skillsDir, { withFileTypes: true });
      for (const folder of skillFolders) {
        if (folder.isDirectory()) {
          const skillFile = join(skillsDir, folder.name, 'SKILL.md');
          if (existsSync(skillFile)) {
            files.push(skillFile);
          }
        }
      }
    } catch {}
  }

  return files;
}

export function buildInitGuidance(workDir: string): string | null {
  const identity = readMemoryFile(workDir, 'IDENTITY.md');
  const user = readMemoryFile(workDir, 'USER.md');
  const soul = readMemoryFile(workDir, 'SOUL.md');
  const agents = readMemoryFile(workDir, 'AGENTS.md');
  const tools = readMemoryFile(workDir, 'TOOLS.md');

  const hasIdentity = identity && !isTemplateOnly(identity);
  const hasUser = user && !isTemplateOnly(user);
  const hasSoul = soul && !isTemplateOnly(soul);
  const hasAgents = agents && !isTemplateOnly(agents);
  const hasTools = tools && !isTemplateOnly(tools);

  const missingFiles: string[] = [];
  if (!hasIdentity) missingFiles.push('IDENTITY.md');
  if (!hasUser) missingFiles.push('USER.md');
  if (!hasSoul) missingFiles.push('SOUL.md');
  if (!hasAgents) missingFiles.push('AGENTS.md');
  if (!hasTools) missingFiles.push('TOOLS.md');

  if (missingFiles.length === 0) return null;

  let guidance = `## ⚠️ MEMORY SETUP REQUIRED (FIRST PRIORITY)\n\n`;
  guidance += `The following memory files are not yet configured: **${missingFiles.join(', ')}**\n\n`;
  guidance += `You MUST guide the user to set up these files, starting with **IDENTITY.md**.\n\n`;
  guidance += `### Setup Steps for IDENTITY.md:\n`;
  guidance += `1. **Greet the user** and explain you need to set up your identity\n`;
  guidance += `2. **Ask the user** the following questions:\n`;
  guidance += `   - What name would you like to call me?\n`;
  guidance += `   - What type of assistant should I be? (e.g., personal assistant, coding helper, project manager)\n`;
  guidance += `   - What emoji represents me best?\n`;
  guidance += `   - What personality/style should I have?\n`;
  guidance += `   - Any specific self-introduction you'd like me to use?\n\n`;
  guidance += `3. **After collecting information**, update \`${workDir}/memory/IDENTITY.md\` with the identity info\n\n`;
  guidance += `### Other Memory Files (set up after IDENTITY.md):\n`;
  guidance += `- **USER.md**: Ask user about their background, work field, preferences\n`;
  guidance += `- **SOUL.md**: You can evolve this yourself based on behavioral insights\n`;
  guidance += `- **AGENTS.md**: You can add better workflows and rules as you learn\n`;
  guidance += `- **TOOLS.md**: Add environment info, paths, configurations as you discover them\n\n`;
  guidance += `**This is your FIRST priority when interacting with a new user. Do NOT skip this step.**`;

  return guidance;
}

// Runs one film through the Claude Agent SDK: Claude reads the SRK-Opuscar guides,
// writes the film's code, renders it and leaves the deliverables in the project folder.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from './config.js';
import { getStyle } from './styles.js';

const LANGS = { en: 'English', zh: 'Chinese (中文)', ta: 'Tamil', hi: 'Hindi', es: 'Spanish', fr: 'French' };

export function buildPrompt(brief, project) {
  const style = getStyle(brief.style);
  const LIB = config.lib;
  const lang = LANGS[brief.language] || brief.language || 'English';
  return `You are running unattended on a server as the director and producer of a short film.
Nobody can answer questions: never ask, never wait for approval. The brief below is final; fill every gap with sensible defaults and keep going until the film is delivered.

## The library
The SRK-Opuscar style library is installed at LIB=${LIB} (core packages, headless browser and Python .venv are ready; ffmpeg, Node and Python are on PATH).
Read and follow, in this order: ${LIB}/AGENTS.md (skip its "Start" section and the brief questions: the brief is already answered), ${LIB}/DIRECTOR.md, ${LIB}/TECHNIQUE.md, ${LIB}/core/README.md and ${LIB}/styles/${brief.style}/STYLE.md.
Do not run setup.sh without arguments. If the film needs narration or plucked strings, install those tiers with:
  sh "${LIB}/plugin/skills/srk-opuscar/scripts/setup.sh" deps voice    (or: deps music)
To read a style's demo source (only after TREATMENT.md is written): sh "${LIB}/plugin/skills/srk-opuscar/scripts/setup.sh" demo ${brief.style}

## Skill-mode rules
- Project folder: ${project}  (wherever the guides say films/<name>/, use this folder). Work only there; never edit ${LIB}/core or ${LIB}/styles.
- Run library tools from LIB with the project's absolute path, e.g.: cd "${LIB}" && node core/render/still.mjs "${project}" 1.5 3
- Pages load library files with absolute URLs (/core/lib.js, /node_modules/three/...); the project is served at /@film/.
- Scripts and build.sh use $LIB (put LIB=${LIB} at the top of build.sh), never ../..
- This server has no GPU: for WebGL/3D styles set LEMO_ANGLE=swiftshader when rendering, and keep scenes light enough to render in reasonable time.
- There is no image generator on this server.
- Keep the user's spending in mind: your budget is limited (about $${config.maxBudgetUsd}). Skip the optional storyboard; do one review round, not many. Prefer --workers 3 for the final render.

## The brief (final)
- Style: ${style ? `${style.name} (${style.nameCn}), folder styles/${brief.style}` : brief.style}
- Topic: ${brief.topic}
- Film language (on-screen text, voice, subtitles): ${lang}
- Target length: about ${brief.duration} seconds
- Narration: ${brief.narration ? 'yes, use the library TTS' : 'no voice-over; music, sound and on-screen text only'}
- Aspect: ${brief.aspect === '9:16' ? 'vertical 1080x1920 (pass --size 1080x1920 to every render tool)' : '16:9, 1920x1080'}
- Notes from the requester: ${brief.notes?.trim() || '(none)'}
- Names, facts or brands: use only what the topic and notes give; never invent real people's quotes or use logos the requester did not supply.

## Delivery (required)
Deliver exactly what DIRECTOR.md §11 lists, at the TOP LEVEL of ${project}: <name>.mp4 (the final muxed film), poster.jpg, the .srt when there is speech or subtitles, TREATMENT.md, CREDITS and build.sh.
Before you finish, verify that the final .mp4 exists at the top level and plays (ffprobe it). Your last message: two or three plain sentences describing the film for the requester.
Progress notes: begin a short line with "STEP:" whenever you move to a new phase (brief, treatment, look, voice, music, animation, render, mix, review, deliver), so the requester can follow along.`;
}

export async function runAgent({ job, project, log, signal }) {
  const ac = new AbortController();
  signal.addEventListener('abort', () => ac.abort(), { once: true });
  log('info', `Starting Claude (${config.model}), budget $${config.maxBudgetUsd}`);

  let result = null;
  const q = query({
    prompt: buildPrompt(job.brief, project),
    options: {
      cwd: project,
      model: config.model,
      abortController: ac,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      // The worker container is the sandbox: no one is there to approve tool calls.
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      disallowedTools: ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'CronCreate', 'RemoteTrigger'],
      additionalDirectories: [config.lib],
      settingSources: [],      // ignore any settings on the server; the prompt is the whole instruction
      env: { ...process.env, SRK_OPUSCAR_HOME: config.lib, LIB: config.lib, IS_SANDBOX: '1' },
      stderr: line => { if (line.trim()) log('debug', line.trim()); },
    },
  });

  for await (const msg of q) {
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content || []) {
        if (block.type === 'text' && block.text.trim()) {
          for (const line of block.text.split('\n')) {
            const m = line.match(/^\s*STEP:\s*(.+)/);
            if (m) log('step', m[1]);
          }
          log('say', block.text.trim());
        } else if (block.type === 'tool_use') {
          log('tool', describeTool(block));
        }
      }
    } else if (msg.type === 'result') {
      result = msg;
    }
  }

  if (!result) throw new Error('The agent stopped without a result');
  const costUsd = result.total_cost_usd ?? null;
  log('info', `Agent finished: ${result.subtype}, ${result.num_turns} turns, about $${(costUsd ?? 0).toFixed(2)}`);
  if (result.subtype !== 'success') {
    const why = {
      error_max_budget_usd: `Stopped at the budget limit ($${config.maxBudgetUsd})`,
      error_max_turns: `Stopped at the turn limit (${config.maxTurns})`,
    }[result.subtype] || 'The agent hit an error';
    // a film may still have been delivered before the limit; jobs.js checks the folder
    return { costUsd, error: why, summary: null };
  }
  return { costUsd, summary: result.result?.slice(0, 1500) || null };
}

function describeTool(block) {
  const i = block.input || {};
  switch (block.name) {
    case 'Bash': return `$ ${String(i.command || '').split('\n')[0].slice(0, 300)}`;
    case 'Read': return `read ${short(i.file_path)}`;
    case 'Write': return `write ${short(i.file_path)}`;
    case 'Edit': return `edit ${short(i.file_path)}`;
    case 'Glob': case 'Grep': return `${block.name.toLowerCase()} ${i.pattern || ''}`;
    default: return block.name;
  }
}

const short = p => String(p || '').replace(config.lib, '$LIB').replace(/^.*\/films\/[a-f0-9]+\/film\//, '');

#!/usr/bin/env node
// Test-only fixture: emulates the documented Antigravity CLI wire format, no Google network calls.
const args = process.argv.slice(2);
if (args[0] === 'models') {
  console.log('gemini-4-carbon-high     Gemini 4 Carbon (High)');
  console.log('gemini-4-argon-high      Gemini 4 Argon (High)');
  process.exit(0);
}
if (!args.includes('--input-format') || args[args.indexOf('--input-format') + 1] !== 'stream-json') {
  console.error('Missing official stream-json input protocol'); process.exit(2);
}
if (!args.includes('--json-schema')) { console.error('Missing output schema'); process.exit(2); }
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const events = input.trim().split('\n').map(JSON.parse);
  const transcript = JSON.parse(events[0].message.content.split('BEGIN_CLIENT_TRANSCRIPT_JSON\n')[1].split('\nEND_CLIENT_TRANSCRIPT_JSON')[0]);
  const requestedTool = transcript.tools.find(x => x.name === 'Read');
  const output = requestedTool ? {
    kind: 'tool_calls', text: '', tool_calls: [{ name: 'Read', input_json: '{"file_path":"README.md"}' }]
  } : { kind: 'final', text: 'fixture response', tool_calls: [] };
  console.log(JSON.stringify({ event: 'init', init: { model: args[args.indexOf('--model') + 1] } }));
  console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', structured_output: output, usage: { input_tokens: 40, output_tokens: 10 } } }));
});

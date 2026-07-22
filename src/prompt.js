const readline = require('readline');

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = String.fromCharCode(127);

// A single shared interface for the process's lifetime. Recreating a
// readline.Interface per question drops any input already buffered ahead
// of the current line when the old interface is closed (matters for piped
// input, and for real typing that outruns a single 'data' event).
let sharedInterface = null;
function getInterface() {
  if (!sharedInterface) {
    sharedInterface = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return sharedInterface;
}

function ask(promptText) {
  return new Promise((resolve) => {
    getInterface().question(promptText, (answer) => resolve(answer.trim()));
  });
}

function closePrompt() {
  if (sharedInterface) {
    sharedInterface.close();
    sharedInterface = null;
  }
}

function askHidden(promptText) {
  return new Promise((resolve, reject) => {
    const { stdin } = process;
    if (!stdin.isTTY) {
      // Fallback for non-interactive input (e.g. piped stdin): read one line, no masking.
      ask(promptText).then(resolve, reject);
      return;
    }

    // Pause the shared line reader so it doesn't compete for stdin bytes
    // with this prompt's own raw keystroke handling.
    sharedInterface?.pause();

    process.stdout.write(promptText);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let input = '';
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeListener('data', onData);
      sharedInterface?.resume();
    };
    const onData = (char) => {
      switch (char) {
        case '\n':
        case '\r':
        case CTRL_D:
          cleanup();
          process.stdout.write('\n');
          resolve(input);
          break;
        case CTRL_C:
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
          break;
        case BACKSPACE:
        case '\b':
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
          break;
        default:
          input += char;
          process.stdout.write('*');
          break;
      }
    };
    stdin.on('data', onData);
  });
}

module.exports = { ask, askHidden, closePrompt };

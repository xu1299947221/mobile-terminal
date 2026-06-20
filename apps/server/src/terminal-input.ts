import { sendKeys, sendKeysThenLiteralKey, sendLiteralKey } from "./tmux.js";

export type TerminalInput = {
  data: string;
  kind: "raw" | "task" | "key";
};

export async function sendTerminalInput(session: string, input: TerminalInput): Promise<void> {
  if (input.kind === "task") {
    await sendKeysThenLiteralKey(session, input.data, "Enter");
    return;
  }
  if (input.kind === "key") {
    await sendLiteralKey(session, input.data);
    return;
  }
  await sendRawInput(session, input.data);
}

async function sendRawInput(session: string, data: string): Promise<void> {
  let text = "";
  const flushText = async (): Promise<void> => {
    if (!text) return;
    await sendKeys(session, text);
    text = "";
  };

  for (let index = 0; index < data.length; index += 1) {
    const special = specialKeyFromSequence(data.slice(index));
    if (special) {
      await flushText();
      await sendLiteralKey(session, special.key);
      index += special.length - 1;
      continue;
    }

    const char = data[index];
    if (char === "\r" || char === "\n") {
      if (text) {
        await sendKeysThenLiteralKey(session, text, "Enter");
        text = "";
      } else {
        await sendLiteralKey(session, "Enter");
      }
    } else if (char === "\t") {
      await flushText();
      await sendLiteralKey(session, "Tab");
    } else if (char === "\x1b") {
      await flushText();
      await sendLiteralKey(session, "Escape");
    } else if (char === "\x03") {
      await flushText();
      await sendLiteralKey(session, "C-c");
    } else if (char === "\x04") {
      await flushText();
      await sendLiteralKey(session, "C-d");
    } else if (char === "\x7f") {
      await flushText();
      await sendLiteralKey(session, "BSpace");
    } else {
      text += char;
    }
  }
  await flushText();
}

function specialKeyFromSequence(data: string): { key: string; length: number } | null {
  const mappings: Array<[string, string]> = [
    ["\x1b[A", "Up"],
    ["\x1b[B", "Down"],
    ["\x1b[C", "Right"],
    ["\x1b[D", "Left"],
    ["\x1b[H", "Home"],
    ["\x1b[F", "End"],
    ["\x1b[3~", "Delete"]
  ];
  const match = mappings.find(([sequence]) => data.startsWith(sequence));
  return match ? { key: match[1], length: match[0].length } : null;
}

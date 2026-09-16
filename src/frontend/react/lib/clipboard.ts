const clipboardLimit = 1_048_576;

/** Clipboard writes go through the main process; renderer clipboard permissions stay denied. */
export function copyText(text: string): void {
  void window.desktop?.clipboard.writeText({ text: text.slice(0, clipboardLimit) });
}

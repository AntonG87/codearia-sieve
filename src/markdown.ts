import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Chrome that survived extraction is still noise for a reader.
turndown.remove(['script', 'style', 'noscript', 'iframe']);

/** Cleaned article HTML → markdown for humans and generative models. */
export function toMarkdown(articleHtml: string): string {
  return turndown.turndown(articleHtml).replace(/\n{3,}/g, '\n\n').trim();
}

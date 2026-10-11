"use client";

import React from "react";
import Link from "next/link";
import styles from "./chat-message-renderer.module.css";

interface ChatMessageRendererProps {
  text: string;
  isCrisis?: boolean;
  role?: "user" | "buddy";
}

interface InlineToken {
  type: "text" | "bold" | "link" | "emergency-phone";
  value: string;
  url?: string;
  label?: string;
}

interface BlockItem {
  type: "paragraph" | "ul" | "ol" | "immediate-danger";
  lines?: string[];
  items?: string[];
  content?: string;
}

/**
 * Checks whether text explicitly conveys immediate life danger instructions.
 */
function isImmediateDangerInstruction(line: string): boolean {
  return /\b(immediate\s+danger|call\s+112\b|in\s+immediate\s+danger|threat\s+to\s+life|emergency\s+services:\s*112)/i.test(
    line
  );
}

/**
 * Checks whether a bold phrase in a crisis message represents an emergency instruction or helpline.
 */
function isCrisisDirective(boldText: string): boolean {
  return /\b(112|14566|14416|nhaa|tele-manas|emergency|immediate\s+danger|danger|helpline|support\s+immediately)\b/i.test(
    boldText
  );
}

/**
 * Tokenizes a line into inline segments (bold, links, crisis helplines, plain text).
 */
function tokenizeInline(text: string, isCrisis: boolean): InlineToken[] {
  // Pattern to catch **bold**, [link](url), and known helplines in crisis messages
  const regex = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\b(?:14566|14416|112)\b)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  const tokens: InlineToken[] = [];

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({
        type: "text",
        value: text.slice(lastIdx, match.index),
      });
    }

    const val = match[0];
    if (val.startsWith("**") && val.endsWith("**") && val.length >= 4) {
      tokens.push({
        type: "bold",
        value: val.slice(2, -2),
      });
    } else if (val.startsWith("[")) {
      const linkMatch = val.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        tokens.push({
          type: "link",
          label: linkMatch[1],
          url: linkMatch[2],
          value: linkMatch[1],
        });
      } else {
        tokens.push({ type: "text", value: val });
      }
    } else if (isCrisis && (val === "14566" || val === "14416" || val === "112")) {
      tokens.push({
        type: "emergency-phone",
        value: val,
      });
    } else {
      tokens.push({ type: "text", value: val });
    }

    lastIdx = regex.lastIndex;
  }

  if (lastIdx < text.length) {
    tokens.push({
      type: "text",
      value: text.slice(lastIdx),
    });
  }

  return tokens;
}

/**
 * Renders inline tokens into accessible React elements.
 */
function renderInlineContent(
  text: string,
  isCrisis: boolean = false,
  keyPrefix: string = "inline"
): React.ReactNode[] {
  const tokens = tokenizeInline(text, isCrisis);

  return tokens.map((token, idx) => {
    const key = `${keyPrefix}-${idx}`;

    if (token.type === "bold") {
      const isUrgent = isCrisis && isCrisisDirective(token.value);
      return (
        <strong
          key={key}
          className={isUrgent ? styles.emergencyBold : styles.boldText}
        >
          {renderInlineContent(token.value, isCrisis, `${key}-inner`)}
        </strong>
      );
    }

    if (token.type === "link" && token.url) {
      const isInternal = token.url.startsWith("/") || token.url.startsWith("#");
      if (isInternal) {
        return (
          <Link key={key} href={token.url} className={styles.inlineLink}>
            {token.label || token.value}
          </Link>
        );
      }
      return (
        <a
          key={key}
          href={token.url}
          className={styles.inlineLink}
          target="_blank"
          rel="noopener noreferrer"
        >
          {token.label || token.value}
        </a>
      );
    }

    if (token.type === "emergency-phone") {
      const telLabels: Record<string, string> = {
        "14566": "Call National Helpline Against Atrocities at 14566",
        "14416": "Call Tele-MANAS Mental Health Support at 14416",
        "112": "Call National Emergency Services at 112",
      };
      return (
        <a
          key={key}
          href={`tel:${token.value}`}
          className={styles.emergencyPhoneLink}
          aria-label={telLabels[token.value] || `Call ${token.value}`}
          title={telLabels[token.value] || `Call ${token.value}`}
        >
          <span>📞</span>
          <span>{token.value}</span>
        </a>
      );
    }

    return <React.Fragment key={key}>{token.value}</React.Fragment>;
  });
}

/**
 * Parses markdown into structured blocks (paragraphs, lists, immediate danger callouts).
 */
function parseBlocks(markdown: string, isCrisis: boolean): BlockItem[] {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockItem[] = [];
  let currentParagraph: string[] = [];
  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;

  function flushParagraph() {
    if (currentParagraph.length > 0) {
      blocks.push({ type: "paragraph", lines: [...currentParagraph] });
      currentParagraph = [];
    }
  }

  function flushList() {
    if (currentList) {
      blocks.push(currentList);
      currentList = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Blank line indicates block break
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    // In a genuine crisis message, highlight standalone immediate danger instructions
    if (isCrisis && isImmediateDangerInstruction(trimmed) && !trimmed.startsWith("-") && !trimmed.startsWith("*")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "immediate-danger", content: trimmed });
      continue;
    }

    // Unordered list item: - or *
    const ulMatch = rawLine.match(/^\s*[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(ulMatch[1]);
      continue;
    }

    // Ordered list item: 1. or 2.
    const olMatch = rawLine.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(olMatch[1]);
      continue;
    }

    // Regular line in paragraph
    flushList();
    currentParagraph.push(rawLine);
  }

  flushParagraph();
  flushList();

  return blocks;
}

export function ChatMessageRenderer({
  text,
  isCrisis = false,
  role = "buddy",
}: ChatMessageRendererProps) {
  if (!text) return null;

  const blocks = parseBlocks(text, !!isCrisis);

  return (
    <div className={styles.rendererRoot}>
      {isCrisis && role === "buddy" && (
        <div className={styles.crisisBadgeHeader} role="alert" aria-label="Safety support message">
          <span>⚡</span>
          <span>Crisis Safety Guidance</span>
        </div>
      )}

      {blocks.map((block, bIdx) => {
        if (block.type === "immediate-danger" && block.content) {
          return (
            <div
              key={`block-${bIdx}`}
              className={styles.immediateDangerBox}
              role="alert"
              aria-label="Immediate danger instruction"
            >
              <span className={styles.immediateDangerIcon} aria-hidden>
                🚨
              </span>
              <div className={styles.immediateDangerContent}>
                {renderInlineContent(block.content, isCrisis, `id-${bIdx}`)}
              </div>
            </div>
          );
        }

        if (block.type === "ul" && block.items) {
          return (
            <ul key={`block-${bIdx}`} className={styles.unorderedList}>
              {block.items.map((item, itemIdx) => (
                <li key={`item-${bIdx}-${itemIdx}`} className={styles.listItem}>
                  {renderInlineContent(item, isCrisis, `li-${bIdx}-${itemIdx}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol" && block.items) {
          return (
            <ol key={`block-${bIdx}`} className={styles.orderedList}>
              {block.items.map((item, itemIdx) => (
                <li key={`item-${bIdx}-${itemIdx}`} className={styles.listItem}>
                  {renderInlineContent(item, isCrisis, `oli-${bIdx}-${itemIdx}`)}
                </li>
              ))}
            </ol>
          );
        }

        // Paragraph block
        if (block.lines && block.lines.length > 0) {
          return (
            <p key={`block-${bIdx}`} className={styles.paragraph}>
              {block.lines.map((line, lineIdx) => (
                <React.Fragment key={`line-${bIdx}-${lineIdx}`}>
                  {lineIdx > 0 && <br />}
                  {renderInlineContent(line, isCrisis, `p-${bIdx}-${lineIdx}`)}
                </React.Fragment>
              ))}
            </p>
          );
        }

        return null;
      })}
    </div>
  );
}

export default ChatMessageRenderer;

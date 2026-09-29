"use client";

import { Menu, MenuLink } from "@/components/menu";
import {
  BookIcon,
  DownloadIcon,
  FileTextIcon,
} from "@/components/icons";

/**
 * Download this article in one of the three formats the server can render.
 *
 * Markdown is the one-way readable export (`lib/markdown.ts`); PDF is laid out
 * by `lib/pdf.ts`; EPUB is packed by `lib/epub.ts`. All three are plain GETs,
 * so these are anchors with `download` — the browser saves them without the
 * page having to hold a blob in memory.
 */
export function DownloadMenu({
  articleId,
  buttonClass,
}: {
  articleId: string;
  buttonClass: string;
}) {
  return (
    <Menu
      label="Download"
      testId="download-menu"
      className={buttonClass}
      icon={<DownloadIcon />}
    >
      {(close) => (
        <>
          <MenuLink
            icon={<FileTextIcon />}
            label="Markdown (.md)"
            href={`/api/articles/${articleId}/markdown`}
            onSelect={close}
            testId="download-markdown"
          />
          <MenuLink
            icon={<FileTextIcon />}
            label="PDF (.pdf)"
            href={`/api/articles/${articleId}/pdf`}
            onSelect={close}
            testId="download-pdf"
          />
          <MenuLink
            icon={<BookIcon />}
            label="EPUB (.epub)"
            href={`/api/articles/${articleId}/epub`}
            onSelect={close}
            testId="download-epub"
          />
        </>
      )}
    </Menu>
  );
}

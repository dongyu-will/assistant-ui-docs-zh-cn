"use client";

import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  EditIcon,
  MessageSquareWarning,
} from "lucide-react";
import type { ReactNode } from "react";

type FooterItem = {
  name: ReactNode;
  url: string;
  section?: ReactNode;
};

type DocsFooterProps = {
  previous?: FooterItem | undefined;
  next?: FooterItem | undefined;
  githubEditUrl?: string | undefined;
  feedbackUrl?: string | undefined;
};

export function DocsFooter({
  previous,
  next,
  githubEditUrl,
  feedbackUrl,
}: DocsFooterProps) {
  if (!previous && !next && !githubEditUrl && !feedbackUrl) return null;

  return (
    <footer className="not-prose mt-16 text-sm">
      {(githubEditUrl || feedbackUrl) && (
        <div className="border-border text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-6">
          <span>发现翻译有问题？</span>
          {feedbackUrl && (
            <a
              href={feedbackUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
            >
              <MessageSquareWarning className="size-4" />
              反馈翻译问题
            </a>
          )}
          {githubEditUrl && (
            <a
              href={githubEditUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
            >
              <EditIcon className="size-4" />
              直接编辑此页
            </a>
          )}
        </div>
      )}

      {(previous || next) && (
        <nav className="mt-8 flex items-center justify-between gap-4">
          {previous ? (
            <Link
              href={previous.url}
              className="group text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1.5 transition-colors"
            >
              <ChevronLeft className="size-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />
              <span className="min-w-0 truncate">
                {previous.section ? (
                  <span className="opacity-60">{previous.section} / </span>
                ) : null}
                {previous.name}
              </span>
            </Link>
          ) : (
            <span />
          )}

          {next ? (
            <Link
              href={next.url}
              className="group text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1.5 transition-colors"
            >
              <span className="min-w-0 truncate">
                {next.section ? (
                  <span className="opacity-60">{next.section} / </span>
                ) : null}
                {next.name}
              </span>
              <ChevronRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </footer>
  );
}

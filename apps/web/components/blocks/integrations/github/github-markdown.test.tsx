/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GithubMarkdown } from "./github-markdown";

afterEach(cleanup);

// A row of Vercel's deployment comment, as GitHub serves it.
const vercelRow = [
  "| Project | Deployment |",
  "| :--- | :----- |",
  '| <a href="https://vercel.com/p"><sup><img src="https://vercel.com/avatar.png" width="16" height="16" align="middle" alt="avatar" /></sup></a> [convoy-docs](https://vercel.com/p) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](https://vercel.com/d) |',
].join("\n");

describe("GithubMarkdown (OS-2403)", () => {
  test("images sit inline with their text, without Streamdown's image wrapper", () => {
    const { container } = render(<GithubMarkdown>{vercelRow}</GithubMarkdown>);

    expect(container.querySelector('[data-streamdown="image-wrapper"]')).toBeNull();
    expect(screen.getByAltText("Ready").className).toContain("align-middle");
  });

  test("a superscript holding only an image is dropped, so it doesn't lift the image", () => {
    render(<GithubMarkdown>{vercelRow}</GithubMarkdown>);

    expect(screen.getByAltText("avatar").closest("sup")).toBeNull();
  });

  test("a superscript with text stays a superscript", () => {
    render(<GithubMarkdown>{"x<sup>2</sup>"}</GithubMarkdown>);

    expect(screen.getByText("2").tagName).toBe("SUP");
  });

  test("an @mention is bold, as on GitHub; an email, code, and a link aren't", () => {
    const { container } = render(<GithubMarkdown>{"cc @octo-cat, (@sam) me@example.com `@code` [@link](https://x.dev)"}</GithubMarkdown>);

    expect([...container.querySelectorAll('[data-streamdown="strong"]')].map((strong) => strong.textContent)).toEqual(["@octo-cat", "@sam"]);
  });
});

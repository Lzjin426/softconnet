// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Snapshot } from "./types";

const { invoke, open, confirm } = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open, confirm }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

import App from "./App";

const source = "/source/shared.md";
const link = "/projects/alpha/shared.md";
const snapshot: Snapshot = {
  roots: ["/projects"],
  scanWarnings: [],
  sources: [{
    path: source,
    kind: "file",
    manual: true,
    links: [{ path: link, target: source, project: "alpha", status: "healthy" }],
  }],
};

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset().mockResolvedValue(snapshot);
  open.mockReset().mockResolvedValue("/projects/beta");
  confirm.mockReset().mockResolvedValue(false);
});

afterEach(() => cleanup());

test("shows a scanned link and a rejected name collision without losing the existing link", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole("heading", { name: "shared.md" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /alpha.*正常/s })).toBeTruthy();

  invoke.mockImplementation((command: string) => {
    if (command === "create_link") return Promise.reject("目标位置已经有文件、文件夹或软链接；未进行覆盖");
    return Promise.resolve(snapshot);
  });
  await user.click(screen.getByRole("button", { name: "新增链接" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "浏览" }));
  await user.click(within(dialog).getByRole("button", { name: "创建链接" }));

  expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("未进行覆盖"));
  expect(screen.getByRole("button", { name: /alpha.*正常/s })).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("create_link", { source, folder: "/projects/beta", name: "shared.md" });
});

test("filters broken links as issues", async () => {
  const user = userEvent.setup();
  const broken: Snapshot = structuredClone(snapshot);
  broken.sources[0].links[0].status = "source_missing";
  invoke.mockResolvedValue(broken);
  render(<App />);
  expect(await screen.findByRole("button", { name: /alpha.*源文件缺失/s })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "正常" }));
  expect(screen.getByText("此筛选条件下没有链接")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "需处理" }));
  expect(screen.getByRole("button", { name: /alpha.*源文件缺失/s })).toBeTruthy();
});

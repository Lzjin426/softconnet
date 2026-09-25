// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BatchOperationResult, BatchPreview, Snapshot } from "./types";

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
    tags: ["共享"],
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
  expect(within(screen.getByRole("region", { name: "窄窗口链接操作" })).getByRole("button", { name: "删除当前链接" })).toBeTruthy();

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

test("marks a source replaced by a symlink and blocks new links", async () => {
  const replaced: Snapshot = structuredClone(snapshot);
  replaced.sources[0].kind = "symlink";
  invoke.mockResolvedValue(replaced);
  render(<App />);
  expect(await screen.findByText("事实源 · 已替换为软链接")).toBeTruthy();
  expect(screen.getByRole("button", { name: "新增链接" })).toHaveProperty("disabled", true);
});

test("keeps the batch preview tied to its folder and keyboard focus inside the dialog", async () => {
  const user = userEvent.setup();
  let resolvePreview!: (value: BatchPreview) => void;
  const delayedPreview = new Promise<BatchPreview>((resolve) => { resolvePreview = resolve; });
  invoke.mockImplementation((command: string) => command === "preview_batch_create" ? delayedPreview : Promise.resolve(snapshot));
  render(<App />);
  expect(await screen.findByRole("heading", { name: "shared.md" })).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "选择事实源 shared.md" }));
  await user.click(screen.getByRole("button", { name: "批量创建链接" }));
  const dialog = screen.getByRole("dialog", { name: "批量创建链接" });
  const close = within(dialog).getByRole("button", { name: "关闭" });
  close.focus();
  await user.tab({ shift: true });
  expect(dialog.contains(document.activeElement)).toBe(true);

  const folder = within(dialog).getByLabelText("统一目标文件夹绝对路径");
  await user.type(folder, "/projects/batch");
  await user.click(within(dialog).getByRole("button", { name: "预览冲突" }));
  expect(folder).toHaveProperty("disabled", true);
  await act(async () => {
    resolvePreview({ items: [{ source, path: "/projects/batch/shared.md", status: "ready", message: "可以创建" }] });
  });
  expect(within(dialog).getByRole("button", { name: "确认并创建" })).toBeTruthy();
});

test("does not focus background search with Ctrl+K while a dialog is open", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole("heading", { name: "shared.md" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "新增链接" }));
  const dialog = screen.getByRole("dialog", { name: "新增链接" });
  await user.keyboard("{Control>}k{/Control}");
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "搜索事实源" }));
});

test("accepts manually entered absolute paths for sources, scan roots, and links", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole("heading", { name: "shared.md" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "添加事实源" }));
  await user.click(screen.getByRole("button", { name: "添加文件" }));
  const sourceDialog = screen.getByRole("dialog", { name: "添加文件事实源" });
  await user.type(within(sourceDialog).getByLabelText("事实源绝对路径"), "C:\\workspace\\shared.md");
  await user.click(within(sourceDialog).getByRole("button", { name: "添加事实源" }));
  expect(invoke).toHaveBeenCalledWith("add_source", { path: "C:\\workspace\\shared.md", expectedKind: "file" });

  await user.click(screen.getByRole("button", { name: "添加扫描目录" }));
  const rootDialog = screen.getByRole("dialog", { name: "添加扫描目录" });
  await user.type(within(rootDialog).getByLabelText("扫描目录绝对路径"), "C:\\workspace\\projects");
  await user.click(within(rootDialog).getByRole("button", { name: "开始扫描" }));
  expect(invoke).toHaveBeenCalledWith("add_root", { path: "C:\\workspace\\projects" });

  await user.click(screen.getByRole("button", { name: "新增链接" }));
  const linkDialog = screen.getByRole("dialog", { name: "新增链接" });
  await user.type(within(linkDialog).getByLabelText("目标文件夹绝对路径"), "C:\\workspace\\beta");
  await user.click(within(linkDialog).getByRole("button", { name: "创建链接" }));
  expect(invoke).toHaveBeenCalledWith("create_link", { source, folder: "C:\\workspace\\beta", name: "shared.md" });
});

test("opens the canonical source returned after adding an alias path", async () => {
  const user = userEvent.setup();
  const initial: Snapshot = {
    ...snapshot,
    sources: [{ path: "/source/first.md", kind: "file", manual: true, tags: [], links: [] }],
  };
  const canonicalPath = "C:\\workspace\\shared.md";
  const added: Snapshot = {
    ...initial,
    selectedSourcePath: canonicalPath,
    sources: [...initial.sources, { path: canonicalPath, kind: "file", manual: true, tags: [], links: [] }],
  };
  invoke.mockImplementation((command: string) => Promise.resolve(command === "add_source" ? added : initial));
  render(<App />);
  expect(await screen.findByRole("heading", { name: "first.md" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "添加事实源" }));
  await user.click(screen.getByRole("button", { name: "添加文件" }));
  const dialog = screen.getByRole("dialog", { name: "添加文件事实源" });
  await user.type(within(dialog).getByLabelText("事实源绝对路径"), "C:\\workspace\\nested\\..\\shared.md");
  await user.click(within(dialog).getByRole("button", { name: "添加事实源" }));
  expect(await screen.findByRole("heading", { name: "shared.md" })).toBeTruthy();
});

test("persists source tags and filters the source list by one tag", async () => {
  const user = userEvent.setup();
  const tagged: Snapshot = {
    ...snapshot,
    sources: [
      { ...snapshot.sources[0], tags: ["共享", "文档"] },
      { path: "/source/other.md", kind: "file", manual: true, tags: ["代码"], links: [] },
    ],
  };
  const updated: Snapshot = {
    ...tagged,
    sources: [{ ...tagged.sources[0], tags: ["团队", "文档"] }, tagged.sources[1]],
  };
  invoke.mockImplementation((command: string) => command === "set_source_tags" ? Promise.resolve(updated) : Promise.resolve(tagged));
  render(<App />);
  expect(await screen.findByRole("heading", { name: "shared.md" })).toBeTruthy();

  await user.selectOptions(screen.getByRole("combobox", { name: "按标签筛选" }), "文档");
  expect(screen.getByRole("button", { name: "打开事实源 shared.md" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "打开事实源 other.md" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "全选" }));
  expect(screen.getByRole("checkbox", { name: "选择事实源 shared.md" })).toHaveProperty("checked", true);
  await user.selectOptions(screen.getByRole("combobox", { name: "按标签筛选" }), "代码");
  expect(screen.queryByRole("button", { name: "批量创建链接" })).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "按标签筛选" }), "文档");

  const tagInput = screen.getByRole("textbox", { name: "事实源标签输入" });
  await user.clear(tagInput);
  await user.type(tagInput, "团队, 文档");
  await user.click(screen.getByRole("button", { name: "刷新链接状态" }));
  expect(await screen.findByText("链接状态已刷新")).toBeTruthy();
  expect(tagInput).toHaveProperty("value", "团队, 文档");
  await user.click(screen.getByRole("button", { name: "保存标签" }));
  expect(invoke).toHaveBeenCalledWith("set_source_tags", { path: source, tags: ["团队", "文档"] });
  expect((await screen.findAllByText("团队")).length).toBeGreaterThan(0);
});

test("previews and reports batch creation and deletion results", async () => {
  const user = userEvent.setup();
  const secondSource = "/source/other.md";
  const multi: Snapshot = {
    ...snapshot,
    sources: [
      { ...snapshot.sources[0], tags: ["共享"] },
      { path: secondSource, kind: "file", manual: true, tags: ["共享"], links: [{ path: "/projects/other.md", target: secondSource, project: "alpha", status: "healthy" }] },
    ],
  };
  const createPreview: BatchPreview = {
    items: [
      { source, path: "/projects/batch/shared.md", status: "ready", message: "目标路径可用" },
      { source: secondSource, path: "/projects/batch/other.md", status: "blocked", message: "目标位置已存在" },
    ],
  };
  const deletePreview: BatchPreview = {
    items: [
      { source, path: link, status: "ready", message: "软链接目标未改变" },
      { source: secondSource, path: "/projects/other.md", status: "blocked", message: "链接已被替换" },
    ],
  };
  const operation: BatchOperationResult = {
    snapshot: multi,
    items: [{ source, path: "/projects/batch/shared.md", success: true, message: "已创建" }],
  };
  const deleteOperation: BatchOperationResult = {
    snapshot: multi,
    items: [{ source, path: link, success: true, message: "已删除" }],
  };
  invoke.mockImplementation((command: string) => {
    if (command === "preview_batch_create") return Promise.resolve(createPreview);
    if (command === "batch_create_links") return Promise.resolve(operation);
    if (command === "preview_batch_delete") return Promise.resolve(deletePreview);
    if (command === "batch_delete_links") return Promise.resolve(deleteOperation);
    return Promise.resolve(multi);
  });
  render(<App />);
  expect(await screen.findByRole("heading", { name: "shared.md" })).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "选择事实源 shared.md" }));
  await user.click(screen.getByRole("checkbox", { name: "选择事实源 other.md" }));

  await user.click(screen.getByRole("button", { name: "批量创建链接" }));
  const createDialog = screen.getByRole("dialog", { name: "批量创建链接" });
  await user.click(screen.getByRole("checkbox", { name: "选择事实源 other.md" }));
  await user.type(within(createDialog).getByLabelText("统一目标文件夹绝对路径"), "/projects/batch");
  await user.click(within(createDialog).getByRole("button", { name: "预览冲突" }));
  expect(await within(createDialog).findByText("会被阻止")).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("preview_batch_create", { sources: [source, secondSource], folder: "/projects/batch" });
  const batchFolder = within(createDialog).getByLabelText("统一目标文件夹绝对路径");
  await user.clear(batchFolder);
  await user.type(batchFolder, "/projects/changed");
  expect(within(createDialog).queryByRole("button", { name: "确认并创建" })).toBeNull();
  await user.click(within(createDialog).getByRole("button", { name: "预览冲突" }));
  expect(invoke).toHaveBeenCalledWith("preview_batch_create", { sources: [source, secondSource], folder: "/projects/changed" });
  await user.click(within(createDialog).getByRole("button", { name: "确认并创建" }));
  expect(invoke).toHaveBeenCalledWith("batch_create_links", { sources: [source], folder: "/projects/changed" });
  expect(await within(createDialog).findByText("成功")).toBeTruthy();
  expect(within(createDialog).getByText(/预览已阻止：目标位置已存在/)).toBeTruthy();
  expect(screen.getByRole("status")).toHaveProperty("textContent", expect.stringContaining("1/2 项成功"));

  await user.click(within(createDialog).getByRole("button", { name: "关闭" }));
  await user.click(screen.getByRole("checkbox", { name: "选择事实源 other.md" }));
  await user.click(screen.getByRole("button", { name: "批量删除链接" }));
  const deleteDialog = screen.getByRole("dialog", { name: "批量删除链接" });
  expect(await within(deleteDialog).findByText(/可删除/)).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("preview_batch_delete", { sources: [source, secondSource] });
  await user.click(screen.getByRole("checkbox", { name: "选择事实源 other.md" }));
  await user.click(within(deleteDialog).getByRole("button", { name: "确认并删除" }));
  expect(await within(deleteDialog).findByText("成功")).toBeTruthy();
  expect(within(deleteDialog).getByText(/预览已阻止：链接已被替换/)).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("batch_delete_links", { sources: [source, secondSource], paths: [link] });
});

# SoftConnet

SoftConnet 是以事实源为中心的桌面软链接管理器。选择现有文件或文件夹，便可查看它在项目中的链接、新建链接、刷新状态，以及只删除链接本身。事实源始终留在原位。

## 使用

在 macOS 上打开 `src-tauri/target/release/bundle/macos/SoftConnet.app`。初次打开后，可以添加事实源，也可以添加扫描目录来发现已有软链接。扫描只遍历选定目录，不进入目录软链接。新建链接时选择目标文件夹和名称；如果同名路径已存在，应用会拒绝覆盖。

链接详情会显示正常、事实源缺失、链接消失、被普通文件替换、目标改变及无法访问等状态。删除前应用会再次检查目标确实是原来的软链接。对于被替换或目标改变的路径，请先在文件管理器中人工检查。

扫描目录、手动添加的事实源和链接记录保存在本机应用数据目录。刷新以当前文件系统为准。移除扫描目录或从列表移除事实源只改变应用记录，不改动磁盘内容。

## 开发

需要 Node.js、pnpm、Rust 和 Tauri 2 的平台依赖。

```sh
pnpm install
pnpm tauri dev
pnpm test
pnpm build
cd src-tauri && cargo test
pnpm tauri build --bundles app
```

macOS 首版提供 `.app`。Rust 文件系统实现包含 Windows 文件及文件夹软链接分支，但 Windows 创建软链接可能需要启用开发者模式或使用管理员权限；本版不提供 Windows 安装包。

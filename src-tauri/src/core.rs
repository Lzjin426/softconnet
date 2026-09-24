use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
struct Registry {
    roots: Vec<String>,
    manual_sources: Vec<String>,
    links: Vec<LinkRecord>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct LinkRecord {
    path: String,
    target: String,
    created_here: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub roots: Vec<String>,
    pub sources: Vec<SourceView>,
    pub scan_warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceView {
    pub path: String,
    pub kind: String,
    pub manual: bool,
    pub links: Vec<LinkView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkView {
    pub path: String,
    pub target: String,
    pub project: String,
    pub status: String,
}

pub struct AppCore {
    config_path: PathBuf,
    registry: Registry,
}

impl AppCore {
    pub fn open(config_path: PathBuf) -> Result<Self, String> {
        let registry = match fs::read(&config_path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| format!("无法读取本地记录：{error}"))?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Registry::default(),
            Err(error) => return Err(format!("无法读取本地记录：{error}")),
        };
        Ok(Self {
            config_path,
            registry,
        })
    }

    fn save(&self) -> Result<(), String> {
        let parent = self
            .config_path
            .parent()
            .ok_or_else(|| "本地记录路径无效".to_string())?;
        fs::create_dir_all(parent).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
        let bytes = serde_json::to_vec_pretty(&self.registry)
            .map_err(|error| format!("无法序列化本地记录：{error}"))?;
        let temporary = self.config_path.with_extension("json.tmp");
        fs::write(&temporary, &bytes).map_err(|error| format!("无法写入本地记录：{error}"))?;
        if fs::rename(&temporary, &self.config_path).is_err() {
            // Windows does not always replace an existing destination with rename.
            fs::write(&self.config_path, &bytes)
                .map_err(|error| format!("无法保存本地记录：{error}"))?;
            let _ = fs::remove_file(&temporary);
        }
        Ok(())
    }

    pub fn add_source(&mut self, path: &str) -> Result<Snapshot, String> {
        let original = Path::new(path);
        let metadata =
            fs::symlink_metadata(original).map_err(|error| format!("无法读取事实源：{error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("请选择原始文件或文件夹，而不是另一条软链接".into());
        }
        if !metadata.is_file() && !metadata.is_dir() {
            return Err("事实源必须是普通文件或文件夹".into());
        }
        let canonical = canonical_string(original)?;
        if !self.registry.manual_sources.contains(&canonical) {
            self.registry.manual_sources.push(canonical);
            self.save()?;
        }
        self.snapshot()
    }

    pub fn forget_source(&mut self, path: &str) -> Result<Snapshot, String> {
        self.registry.manual_sources.retain(|item| item != path);
        self.save()?;
        self.snapshot()
    }

    pub fn add_root(&mut self, path: &str) -> Result<Snapshot, String> {
        let canonical = Path::new(path)
            .canonicalize()
            .map_err(|error| format!("无法读取扫描目录：{error}"))?;
        if !canonical.is_dir() {
            return Err("扫描位置必须是文件夹".into());
        }
        let canonical = display(&canonical);
        if !self.registry.roots.contains(&canonical) {
            self.registry.roots.push(canonical);
            self.save()?;
        }
        self.snapshot()
    }

    pub fn remove_root(&mut self, path: &str) -> Result<Snapshot, String> {
        self.registry.roots.retain(|item| item != path);
        self.registry.links.retain(|link| {
            link.created_here || !Path::new(&link.path).starts_with(Path::new(path))
        });
        self.save()?;
        self.snapshot()
    }

    pub fn create_link(
        &mut self,
        source: &str,
        folder: &str,
        name: &str,
    ) -> Result<Snapshot, String> {
        validate_name(name)?;
        let source_path = Path::new(source);
        let source_metadata =
            fs::symlink_metadata(source_path).map_err(|error| format!("事实源不可用：{error}"))?;
        if source_metadata.file_type().is_symlink() {
            return Err("事实源不能是另一条软链接".into());
        }
        if !source_metadata.is_file() && !source_metadata.is_dir() {
            return Err("事实源必须是普通文件或文件夹".into());
        }
        let source_path = source_path
            .canonicalize()
            .map_err(|error| format!("事实源不可用：{error}"))?;
        let folder_path = Path::new(folder)
            .canonicalize()
            .map_err(|error| format!("目标文件夹不可用：{error}"))?;
        if !folder_path.is_dir() {
            return Err("目标位置必须是文件夹".into());
        }
        let link_path = folder_path.join(name);
        match fs::symlink_metadata(&link_path) {
            Ok(_) => return Err("目标位置已经有文件、文件夹或软链接；未进行覆盖".into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查目标位置：{error}")),
        }
        create_os_link(&source_path, &link_path, source_metadata.is_dir())
            .map_err(|error| format_create_error(&error))?;
        self.registry.links.push(LinkRecord {
            path: display(&link_path),
            target: display(&source_path),
            created_here: true,
        });
        if let Err(error) = self.save() {
            self.registry.links.pop();
            return match remove_os_link(&link_path) {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error}；新建链接也未能撤销，请检查 {}：{rollback_error}",
                    display(&link_path)
                )),
            };
        }
        self.snapshot()
    }

    pub fn delete_link(&mut self, path: &str) -> Result<Snapshot, String> {
        let path = canonical_link_path(Path::new(path))?;
        let record = self
            .registry
            .links
            .iter()
            .find(|item| item.path == path)
            .ok_or_else(|| "这条链接未纳入管理，请先刷新".to_string())?
            .clone();
        let link_path = Path::new(&record.path);
        let metadata = fs::symlink_metadata(link_path)
            .map_err(|error| format!("链接已不存在或无法访问：{error}"))?;
        if !metadata.file_type().is_symlink() {
            return Err("此位置现在不是软链接，已停止删除；请先检查该文件".into());
        }
        let actual =
            read_target(link_path).map_err(|error| format!("无法检查链接目标：{error}"))?;
        if display(&actual) != record.target {
            return Err("链接目标已改变，已停止删除；请先刷新并检查".into());
        }
        remove_os_link(link_path).map_err(|error| format!("无法删除软链接：{error}"))?;
        self.registry.links.retain(|item| item.path != path);
        self.save()?;
        self.snapshot()
    }

    pub fn snapshot(&mut self) -> Result<Snapshot, String> {
        let before = self.registry.clone();
        let mut warnings = Vec::new();
        for root in self.registry.roots.clone() {
            let root_path = Path::new(&root);
            if !root_path.is_dir() {
                warnings.push(format!("扫描目录不可用：{root}"));
                continue;
            }
            for entry in WalkDir::new(root_path).follow_links(false) {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) => {
                        warnings.push(format!("扫描失败：{error}"));
                        continue;
                    }
                };
                if !entry.file_type().is_symlink() {
                    continue;
                }
                let link_path = display(entry.path());
                let target = match read_target(entry.path()) {
                    Ok(target) => display(&target),
                    Err(error) => {
                        warnings.push(format!("无法读取链接 {link_path}：{error}"));
                        continue;
                    }
                };
                match self
                    .registry
                    .links
                    .iter_mut()
                    .find(|item| item.path == link_path)
                {
                    Some(record) if !record.created_here => record.target = target,
                    Some(_) => {}
                    None => self.registry.links.push(LinkRecord {
                        path: link_path,
                        target,
                        created_here: false,
                    }),
                }
            }
        }
        if self.registry != before {
            self.save()?;
        }
        let mut sources: BTreeMap<String, SourceView> = BTreeMap::new();
        for path in &self.registry.manual_sources {
            sources.insert(
                path.clone(),
                SourceView {
                    path: path.clone(),
                    kind: source_kind(path),
                    manual: true,
                    links: Vec::new(),
                },
            );
        }
        for record in &self.registry.links {
            let source = sources
                .entry(record.target.clone())
                .or_insert_with(|| SourceView {
                    path: record.target.clone(),
                    kind: source_kind(&record.target),
                    manual: false,
                    links: Vec::new(),
                });
            source.links.push(LinkView {
                path: record.path.clone(),
                target: record.target.clone(),
                project: project_name(&record.path, &self.registry.roots),
                status: link_status(record),
            });
        }
        let mut sources: Vec<_> = sources.into_values().collect();
        sources.sort_by(|left, right| {
            right
                .manual
                .cmp(&left.manual)
                .then_with(|| left.path.cmp(&right.path))
        });
        for source in &mut sources {
            source
                .links
                .sort_by(|left, right| left.path.cmp(&right.path));
        }
        Ok(Snapshot {
            roots: self.registry.roots.clone(),
            sources,
            scan_warnings: warnings,
        })
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || Path::new(name).file_name().and_then(|value| value.to_str()) != Some(name)
    {
        return Err("链接名称只能是单个文件名，不能包含路径分隔符".into());
    }
    Ok(())
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn canonical_string(path: &Path) -> Result<String, String> {
    path.canonicalize()
        .map(|canonical| display(&canonical))
        .map_err(|error| format!("无法定位事实源：{error}"))
}

fn canonical_link_path(path: &Path) -> Result<String, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "链接路径无效".to_string())?
        .canonicalize()
        .map_err(|error| format!("无法定位链接所在文件夹：{error}"))?;
    let name = path.file_name().ok_or_else(|| "链接路径无效".to_string())?;
    Ok(display(&parent.join(name)))
}

fn read_target(link_path: &Path) -> io::Result<PathBuf> {
    let raw = fs::read_link(link_path)?;
    let joined = if raw.is_absolute() {
        raw
    } else {
        link_path.parent().unwrap_or(Path::new(".")).join(raw)
    };
    Ok(normalize_target(&joined))
}

fn normalize_target(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    let cleaned = clean(path);
    for ancestor in cleaned.ancestors() {
        if let Ok(canonical) = ancestor.canonicalize() {
            if let Ok(suffix) = cleaned.strip_prefix(ancestor) {
                return canonical.join(suffix);
            }
        }
    }
    cleaned
}

fn clean(path: &Path) -> PathBuf {
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                output.pop();
            }
            part => output.push(part.as_os_str()),
        }
    }
    output
}

fn source_kind(path: &str) -> String {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => "directory".into(),
        Ok(metadata) if metadata.is_file() => "file".into(),
        _ => "missing".into(),
    }
}

fn link_status(record: &LinkRecord) -> String {
    let path = Path::new(&record.path);
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_symlink() => "replaced".into(),
        Ok(_) => match read_target(path) {
            Ok(target) if display(&target) != record.target => "retargeted".into(),
            Ok(_) => match fs::metadata(&record.target) {
                Ok(_) => "healthy".into(),
                Err(error) if error.kind() == io::ErrorKind::NotFound => "source_missing".into(),
                Err(_) => "inaccessible".into(),
            },
            Err(_) => "inaccessible".into(),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => "link_missing".into(),
        Err(_) => "inaccessible".into(),
    }
}

fn project_name(path: &str, roots: &[String]) -> String {
    let link = Path::new(path);
    let best_root = roots
        .iter()
        .filter(|root| link.starts_with(Path::new(root)))
        .max_by_key(|root| root.len());
    if let Some(root) = best_root {
        let relative = link.strip_prefix(root).unwrap_or(link);
        if relative.components().count() > 1 {
            if let Some(first) = relative.components().next() {
                return first.as_os_str().to_string_lossy().into_owned();
            }
        }
        return Path::new(root)
            .file_name()
            .map(|part| part.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.clone());
    }
    link.parent()
        .and_then(Path::file_name)
        .map(|part| part.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未分类项目".into())
}

fn format_create_error(error: &io::Error) -> String {
    if error.kind() == io::ErrorKind::PermissionDenied {
        #[cfg(windows)]
        return format!(
            "没有创建软链接的权限。请启用 Windows 开发者模式，或以管理员身份运行：{error}"
        );
        #[cfg(not(windows))]
        return format!("没有权限在目标文件夹中创建软链接：{error}");
    }
    format!("无法创建软链接：{error}")
}

#[cfg(unix)]
fn create_os_link(source: &Path, link: &Path, _directory: bool) -> io::Result<()> {
    std::os::unix::fs::symlink(source, link)
}

#[cfg(windows)]
fn create_os_link(source: &Path, link: &Path, directory: bool) -> io::Result<()> {
    if directory {
        std::os::windows::fs::symlink_dir(source, link)
    } else {
        std::os::windows::fs::symlink_file(source, link)
    }
}

fn remove_os_link(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        fs::remove_file(path)
    }
    #[cfg(windows)]
    {
        fs::remove_file(path).or_else(|error| {
            if !fs::symlink_metadata(path)?.file_type().is_symlink() {
                return Err(error);
            }
            fs::remove_dir(path)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn app(temp: &TempDir) -> AppCore {
        AppCore::open(temp.path().join("app/registry.json")).unwrap()
    }

    #[test]
    fn file_link_edits_the_source_and_deletion_preserves_it() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(&source, "first").unwrap();
        let mut core = app(&temp);
        core.add_source(source.to_str().unwrap()).unwrap();
        let snapshot = core
            .create_link(
                source.to_str().unwrap(),
                project.to_str().unwrap(),
                "linked.md",
            )
            .unwrap();
        assert_eq!(snapshot.sources[0].links[0].status, "healthy");
        fs::write(project.join("linked.md"), "second").unwrap();
        assert_eq!(fs::read_to_string(&source).unwrap(), "second");
        core.delete_link(project.join("linked.md").to_str().unwrap())
            .unwrap();
        assert!(source.exists());
        assert!(!project.join("linked.md").exists());
    }

    #[test]
    fn scans_existing_links_without_following_directory_links() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source-dir");
        let project = temp.path().join("project");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&project).unwrap();
        fs::write(source.join("note.md"), "text").unwrap();
        create_os_link(&source, &project.join("shared"), true).unwrap();
        let mut core = app(&temp);
        let snapshot = core.add_root(project.to_str().unwrap()).unwrap();
        assert_eq!(snapshot.sources.len(), 1);
        assert_eq!(snapshot.sources[0].links.len(), 1);
        assert_eq!(snapshot.sources[0].links[0].status, "healthy");
        assert_eq!(snapshot.sources[0].kind, "directory");
    }

    #[test]
    fn broken_replaced_and_occupied_paths_are_safe() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(&source, "text").unwrap();
        let mut core = app(&temp);
        core.create_link(
            source.to_str().unwrap(),
            project.to_str().unwrap(),
            "linked.md",
        )
        .unwrap();
        assert!(core
            .create_link(
                source.to_str().unwrap(),
                project.to_str().unwrap(),
                "linked.md"
            )
            .is_err());
        fs::remove_file(&source).unwrap();
        assert_eq!(
            core.snapshot().unwrap().sources[0].links[0].status,
            "source_missing"
        );
        fs::remove_file(project.join("linked.md")).unwrap();
        fs::write(project.join("linked.md"), "replacement").unwrap();
        assert_eq!(
            core.snapshot().unwrap().sources[0].links[0].status,
            "replaced"
        );
        assert!(core
            .delete_link(project.join("linked.md").to_str().unwrap())
            .is_err());
        assert_eq!(
            fs::read_to_string(project.join("linked.md")).unwrap(),
            "replacement"
        );
    }

    #[test]
    fn registry_survives_reopening() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        fs::write(&source, "text").unwrap();
        app(&temp).add_source(source.to_str().unwrap()).unwrap();
        let mut reopened = app(&temp);
        let snapshot = reopened.snapshot().unwrap();
        assert_eq!(snapshot.sources.len(), 1);
        assert!(snapshot.sources[0].manual);
    }

    #[test]
    fn permission_error_has_actionable_message() {
        let error = io::Error::from(io::ErrorKind::PermissionDenied);
        let message = format_create_error(&error);
        assert!(message.contains("权限"));
    }

    #[test]
    fn moved_source_missing_link_and_retargeted_link_are_visible() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let other = temp.path().join("other.md");
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(&source, "source").unwrap();
        fs::write(&other, "other").unwrap();
        let link = project.join("linked.md");
        let mut core = app(&temp);
        core.create_link(
            source.to_str().unwrap(),
            project.to_str().unwrap(),
            "linked.md",
        )
        .unwrap();

        fs::rename(&source, temp.path().join("moved.md")).unwrap();
        assert_eq!(
            core.snapshot().unwrap().sources[0].links[0].status,
            "source_missing"
        );
        fs::remove_file(&link).unwrap();
        assert_eq!(
            core.snapshot().unwrap().sources[0].links[0].status,
            "link_missing"
        );
        create_os_link(&other, &link, false).unwrap();
        assert_eq!(
            core.snapshot().unwrap().sources[0].links[0].status,
            "retargeted"
        );
        assert!(core.delete_link(link.to_str().unwrap()).is_err());
        assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
    }

    #[test]
    fn scan_stops_at_directory_link_cycle() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("projects");
        fs::create_dir(&root).unwrap();
        create_os_link(&root, &root.join("cycle"), true).unwrap();
        let snapshot = app(&temp).add_root(root.to_str().unwrap()).unwrap();
        assert_eq!(snapshot.sources.len(), 1);
        assert_eq!(snapshot.sources[0].links.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn discovered_broken_link_keeps_the_same_source_path() {
        let temp = TempDir::new().unwrap();
        let real = temp.path().join("real");
        let alias = temp.path().join("alias");
        let source = real.join("source.md");
        let project = temp.path().join("project");
        fs::create_dir(&real).unwrap();
        fs::create_dir(&project).unwrap();
        fs::write(&source, "content").unwrap();
        create_os_link(&real, &alias, true).unwrap();
        create_os_link(&alias.join("source.md"), &project.join("linked.md"), false).unwrap();
        let mut core = app(&temp);
        let before = core.add_root(project.to_str().unwrap()).unwrap();
        assert_eq!(before.sources[0].path, canonical_string(&source).unwrap());
        fs::rename(&source, real.join("moved.md")).unwrap();
        let after = core.snapshot().unwrap();
        assert_eq!(after.sources.len(), 1);
        assert_eq!(after.sources[0].path, before.sources[0].path);
        assert_eq!(after.sources[0].links[0].status, "source_missing");
    }
}

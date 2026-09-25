use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const QUARANTINE_PREFIX: &str = ".softconnet-quarantine-";

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
struct Registry {
    roots: Vec<String>,
    manual_sources: Vec<String>,
    links: Vec<LinkRecord>,
    #[serde(default, alias = "source_tags")]
    tags: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct LinkRecord {
    path: String,
    target: String,
    created_here: bool,
}

#[derive(Debug, Deserialize, Serialize)]
struct DeleteJournal {
    original: String,
    quarantine: String,
    target: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub roots: Vec<String>,
    pub sources: Vec<SourceView>,
    pub scan_warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_source_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceView {
    pub path: String,
    pub kind: String,
    pub manual: bool,
    pub tags: Vec<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPreview {
    pub items: Vec<BatchPreviewItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPreviewItem {
    pub source: String,
    pub path: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchOperationResult {
    pub snapshot: Snapshot,
    pub items: Vec<BatchOperationItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchOperationItem {
    pub source: String,
    pub path: String,
    pub success: bool,
    pub message: String,
}

pub struct AppCore {
    config_path: PathBuf,
    registry: Registry,
}

impl AppCore {
    pub fn open(config_path: PathBuf) -> Result<Self, String> {
        let registry = match fs::read(&config_path) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(registry) => registry,
                Err(primary_error) => {
                    let backup = backup_path(&config_path)
                        .map_err(|error| format!("本地记录路径无效：{error}"))?;
                    let backup_bytes = fs::read(&backup).map_err(|error| {
                        format!("无法读取本地记录：{primary_error}；备份不可用：{error}")
                    })?;
                    let registry = serde_json::from_slice(&backup_bytes).map_err(|error| {
                        format!("无法读取本地记录：{primary_error}；备份也已损坏：{error}")
                    })?;
                    let corrupt = unique_sibling_path(&config_path, ".corrupt")
                        .map_err(|error| format!("无法保留损坏的本地记录：{error}"))?;
                    fs::rename(&config_path, &corrupt)
                        .map_err(|error| format!("无法保留损坏的本地记录：{error}"))?;
                    if let Err(error) = restore_primary_from_backup(&backup, &config_path) {
                        let rollback = fs::rename(&corrupt, &config_path).err();
                        return Err(match rollback {
                            Some(rollback) => {
                                format!("无法恢复本地记录：{error}；损坏文件也未能放回：{rollback}")
                            }
                            None => format!("无法恢复本地记录：{error}"),
                        });
                    }
                    registry
                }
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let backup = backup_path(&config_path)
                    .map_err(|error| format!("本地记录路径无效：{error}"))?;
                match fs::read(&backup) {
                    Ok(bytes) => {
                        let registry = serde_json::from_slice(&bytes)
                            .map_err(|error| format!("无法读取本地记录备份：{error}"))?;
                        // The backup is a complete previous registry. Recreate the primary file
                        // when possible, while still allowing the app to open if this repair is
                        // blocked by the filesystem.
                        let _ = restore_primary_from_backup(&backup, &config_path);
                        registry
                    }
                    Err(backup_error) if backup_error.kind() == io::ErrorKind::NotFound => {
                        Registry::default()
                    }
                    Err(backup_error) => {
                        return Err(format!("无法读取本地记录备份：{backup_error}"));
                    }
                }
            }
            Err(error) => return Err(format!("无法读取本地记录：{error}")),
        };
        recover_delete_journals(&config_path, &registry)?;
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
        let temporary = unique_sibling_path(&self.config_path, ".tmp")
            .map_err(|error| format!("无法准备本地记录临时文件：{error}"))?;
        let write_result = (|| -> io::Result<()> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temporary);
            return Err(format!("无法写入本地记录：{error}"));
        }

        let backup =
            backup_path(&self.config_path).map_err(|error| format!("本地记录路径无效：{error}"))?;
        let had_primary = match fs::symlink_metadata(&self.config_path) {
            Ok(metadata) if metadata.is_file() || metadata.file_type().is_symlink() => true,
            Ok(_) => {
                let _ = fs::remove_file(&temporary);
                return Err("本地记录路径不是文件".into());
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => false,
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                return Err(format!("无法检查本地记录：{error}"));
            }
        };

        if had_primary {
            if let Err(error) = fs::remove_file(&backup) {
                if error.kind() != io::ErrorKind::NotFound {
                    let _ = fs::remove_file(&temporary);
                    return Err(format!("无法准备本地记录备份：{error}"));
                }
            }
            if let Err(error) = fs::rename(&self.config_path, &backup) {
                let _ = fs::remove_file(&temporary);
                return Err(format!("无法备份本地记录：{error}"));
            }
        }

        if let Err(error) = fs::rename(&temporary, &self.config_path) {
            let restore_error = if had_primary {
                fs::rename(&backup, &self.config_path).err()
            } else {
                None
            };
            let _ = fs::remove_file(&temporary);
            return match restore_error {
                Some(restore_error) => Err(format!(
                    "无法保存本地记录：{error}；原记录也未能恢复：{restore_error}"
                )),
                None => Err(format!("无法保存本地记录：{error}")),
            };
        }

        // The file itself is durable before the rename. Syncing the directory makes the
        // rename durable on Unix; it is harmless to skip this best-effort step elsewhere.
        #[cfg(unix)]
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
        Ok(())
    }

    pub fn add_source(&mut self, path: &str) -> Result<Snapshot, String> {
        self.add_source_with_kind(path, None)
    }

    pub fn add_source_with_kind(
        &mut self,
        path: &str,
        expected_kind: Option<&str>,
    ) -> Result<Snapshot, String> {
        let (canonical, is_dir) = validate_existing_source(path)?;
        validate_expected_kind(expected_kind, is_dir)?;
        let canonical = display(&canonical);
        if !self
            .registry
            .manual_sources
            .iter()
            .any(|item| paths_equal(item, &canonical))
        {
            let previous = self.registry.clone();
            self.registry.manual_sources.push(canonical.clone());
            if let Err(error) = self.save() {
                self.registry = previous;
                return Err(error);
            }
        }
        let mut snapshot = self.snapshot()?;
        snapshot.selected_source_path = Some(canonical);
        Ok(snapshot)
    }

    pub fn forget_source(&mut self, path: &str) -> Result<Snapshot, String> {
        let canonical = normalize_absolute_path(path, "事实源路径")?;
        let previous = self.registry.clone();
        let has_links = self
            .registry
            .links
            .iter()
            .any(|link| paths_equal(&link.target, &canonical));
        self.registry
            .manual_sources
            .retain(|item| !paths_equal(item, &canonical));
        if !has_links {
            self.registry
                .tags
                .retain(|item, _| !paths_equal(item, &canonical));
        }
        if let Err(error) = self.save() {
            self.registry = previous;
            return Err(error);
        }
        self.snapshot()
    }

    pub fn add_root(&mut self, path: &str) -> Result<Snapshot, String> {
        let canonical = display(&validate_existing_folder(path, "扫描目录")?);
        if !self
            .registry
            .roots
            .iter()
            .any(|item| paths_equal(item, &canonical))
        {
            let previous = self.registry.clone();
            self.registry.roots.push(canonical);
            if let Err(error) = self.save() {
                self.registry = previous;
                return Err(error);
            }
        }
        self.snapshot()
    }

    pub fn remove_root(&mut self, path: &str) -> Result<Snapshot, String> {
        let normalized = normalize_absolute_path(path, "扫描目录路径")?;
        let resolved_existing = validate_existing_folder(path, "扫描目录")
            .ok()
            .map(|path| display(&path));
        let root_paths = [Some(normalized.clone()), resolved_existing];
        let previous = self.registry.clone();
        self.registry.roots.retain(|item| {
            !root_paths
                .iter()
                .flatten()
                .any(|root| paths_equal(item, root))
        });
        self.registry.links.retain(|link| {
            link.created_here
                || !root_paths
                    .iter()
                    .flatten()
                    .any(|root| path_starts_with(&link.path, root))
        });
        if let Err(error) = self.save() {
            self.registry = previous;
            return Err(error);
        }
        self.snapshot()
    }

    pub fn create_link(
        &mut self,
        source: &str,
        folder: &str,
        name: &str,
    ) -> Result<Snapshot, String> {
        validate_name(name)?;
        let (source_path, source_is_dir) = validate_existing_source(source)?;
        let folder_path = validate_existing_folder(folder, "目标文件夹")?;
        let link_path = folder_path.join(name);
        match fs::symlink_metadata(&link_path) {
            Ok(_) => return Err("目标位置已经有文件、文件夹或软链接；未进行覆盖".into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查目标位置：{error}")),
        }
        create_os_link(&source_path, &link_path, source_is_dir)
            .map_err(|error| format_create_error(&error))?;
        let previous_links = self.registry.links.clone();
        let link_path_string = display(&link_path);
        self.registry
            .links
            .retain(|record| !paths_equal(&record.path, &link_path_string));
        self.registry.links.push(LinkRecord {
            path: link_path_string,
            target: display(&source_path),
            created_here: true,
        });
        if let Err(error) = self.save() {
            self.registry.links = previous_links;
            return match remove_os_link(&link_path) {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error}；新建链接也未能撤销，请检查 {}：{rollback_error}",
                    display(&link_path)
                )),
            };
        }
        self.snapshot_after_mutation()
    }

    pub fn delete_link(&mut self, path: &str) -> Result<Snapshot, String> {
        let path = canonical_link_path(Path::new(path))?;
        let record = self
            .registry
            .links
            .iter()
            .find(|item| paths_equal(&item.path, &path))
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
        if !paths_equal(&display(&actual), &record.target) {
            return Err("链接目标已改变，已停止删除；请先刷新并检查".into());
        }

        let quarantine = unique_quarantine_path(link_path)
            .map_err(|error| format!("无法准备链接删除：{error}"))?;
        let journal_path = write_delete_journal(
            &self.config_path,
            &DeleteJournal {
                original: record.path.clone(),
                quarantine: display(&quarantine),
                target: record.target.clone(),
            },
        )?;
        if let Err(error) = fs::rename(link_path, &quarantine) {
            let _ = fs::remove_file(&journal_path);
            return Err(format!("无法暂存软链接：{error}"));
        }
        let previous = self.registry.clone();
        self.registry
            .links
            .retain(|item| !paths_equal(&item.path, &path));
        if let Err(error) = self.save() {
            self.registry = previous;
            return match fs::rename(&quarantine, link_path) {
                Ok(()) => {
                    let _ = fs::remove_file(&journal_path);
                    Err(error)
                }
                Err(rollback_error) => Err(format!(
                    "{error}；软链接也未能恢复，重启时将尝试恢复 {}：{rollback_error}",
                    display(link_path)
                )),
            };
        }
        if let Err(error) = remove_os_link(&quarantine) {
            return Err(format!(
                "无法删除暂存软链接 {}：{error}；重启时将继续处理",
                display(&quarantine)
            ));
        }
        let _ = fs::remove_file(&journal_path);
        self.snapshot_after_mutation()
    }

    pub fn set_source_tags(&mut self, path: &str, tags: Vec<String>) -> Result<Snapshot, String> {
        let canonical = normalize_absolute_path(path, "事实源路径")?;
        let tags = normalize_tags(tags);
        let tag_key = self
            .registry
            .tags
            .keys()
            .find(|item| paths_equal(item, &canonical))
            .cloned();
        let managed = self
            .registry
            .manual_sources
            .iter()
            .any(|item| paths_equal(item, &canonical))
            || self
                .registry
                .links
                .iter()
                .any(|link| paths_equal(&link.target, &canonical))
            || tag_key.is_some();
        if !managed {
            return Err("事实源尚未纳入管理，不能设置标签".into());
        }
        match fs::symlink_metadata(Path::new(&canonical)) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                if !tags.is_empty() {
                    return Err("事实源路径当前是软链接，不能设置新标签".into());
                }
            }
            Ok(_) => {
                validate_existing_source(&canonical)?;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("事实源不可用：{error}")),
        }
        let previous = self.registry.clone();
        if tags.is_empty() {
            self.registry
                .tags
                .retain(|item, _| !paths_equal(item, &canonical));
        } else {
            self.registry
                .tags
                .retain(|item, _| !paths_equal(item, &canonical));
            self.registry
                .tags
                .insert(tag_key.unwrap_or(canonical), tags);
        }
        if let Err(error) = self.save() {
            self.registry = previous;
            return Err(error);
        }
        self.snapshot()
    }

    pub fn preview_batch_create(
        &mut self,
        sources: Vec<String>,
        folder: String,
    ) -> Result<BatchPreview, String> {
        let folder_result = validate_existing_folder(&folder, "目标文件夹");
        let folder_path = folder_result.as_ref().ok();
        let folder_error = folder_result.as_ref().err().cloned();
        let mut items = Vec::with_capacity(sources.len());
        let mut ready_paths: BTreeMap<String, Vec<usize>> = BTreeMap::new();

        for source in sources {
            let source_result = validate_existing_source(&source);
            let source_path = source_result.as_ref().ok().map(|(path, _)| path);
            let name = source_path
                .and_then(|path| source_basename(path))
                .or_else(|| source_basename(Path::new(&source)));
            let path = name
                .map(|name| match folder_path {
                    Some(folder_path) => display(&folder_path.join(name)),
                    None => display(&Path::new(&folder).join(name)),
                })
                .unwrap_or_default();

            let (status, message) = if let Some(error) = &folder_error {
                ("blocked", error.clone())
            } else if let Err(error) = source_result {
                ("blocked", error)
            } else if name.is_none() {
                ("blocked", "事实源路径没有可用的文件名".into())
            } else {
                match fs::symlink_metadata(&path) {
                    Ok(_) => (
                        "blocked",
                        "目标位置已经有文件、文件夹或软链接；未进行覆盖".into(),
                    ),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {
                        ready_paths
                            .entry(path_key(&path))
                            .or_default()
                            .push(items.len());
                        ("ready", "可以创建".into())
                    }
                    Err(error) => ("blocked", format!("无法检查目标位置：{error}")),
                }
            };
            items.push(BatchPreviewItem {
                source,
                path,
                status: status.into(),
                message,
            });
        }

        for indexes in ready_paths.values().filter(|indexes| indexes.len() > 1) {
            for index in indexes {
                items[*index].status = "blocked".into();
                items[*index].message = "批量操作中存在同名目标；未进行覆盖".into();
            }
        }

        Ok(BatchPreview { items })
    }

    pub fn batch_create_links(
        &mut self,
        sources: Vec<String>,
        folder: String,
    ) -> Result<BatchOperationResult, String> {
        let folder_valid = validate_existing_folder(&folder, "目标文件夹").is_ok();
        let mut candidates = Vec::with_capacity(sources.len());
        let mut candidate_counts: BTreeMap<String, usize> = BTreeMap::new();
        for source in &sources {
            let source_valid = validate_existing_source(source).ok();
            let name = source_valid
                .as_ref()
                .and_then(|(path, _)| source_basename(path))
                .or_else(|| source_basename(Path::new(source)))
                .map(str::to_owned);
            let path = batch_candidate_path(&folder, name.as_deref());
            if folder_valid && source_valid.is_some() && !path.is_empty() {
                *candidate_counts.entry(path_key(&path)).or_default() += 1;
            }
            candidates.push((path, name));
        }
        let duplicate_paths: BTreeMap<_, _> = candidate_counts
            .into_iter()
            .filter(|(_, count)| *count > 1)
            .collect();
        let mut items = Vec::with_capacity(sources.len());
        for (source, (path, name)) in sources.into_iter().zip(candidates) {
            let result = if duplicate_paths.contains_key(&path_key(&path)) {
                Err("批量操作中存在同名目标；未进行覆盖".into())
            } else {
                match name {
                    Some(name) => self.create_link(&source, &folder, &name),
                    None => Err("事实源路径没有可用的文件名".into()),
                }
            };
            match result {
                Ok(_) => items.push(BatchOperationItem {
                    source,
                    path,
                    success: true,
                    message: "链接已创建".into(),
                }),
                Err(error) => items.push(BatchOperationItem {
                    source,
                    path,
                    success: false,
                    message: error,
                }),
            }
        }
        let snapshot = self.snapshot_after_mutation()?;
        Ok(BatchOperationResult { snapshot, items })
    }

    pub fn preview_batch_delete(&mut self, sources: Vec<String>) -> Result<BatchPreview, String> {
        self.snapshot()?;
        let mut items = Vec::new();
        for source in sources {
            let source_key = match normalize_absolute_path(&source, "事实源路径") {
                Ok(path) => path,
                Err(error) => {
                    items.push(BatchPreviewItem {
                        source,
                        path: String::new(),
                        status: "blocked".into(),
                        message: error,
                    });
                    continue;
                }
            };
            let records: Vec<_> = self
                .registry
                .links
                .iter()
                .filter(|record| paths_equal(&record.target, &source_key))
                .cloned()
                .collect();
            if records.is_empty() {
                continue;
            }
            for record in records {
                let status = link_status(&record);
                let (preview_status, message) =
                    if matches!(status.as_str(), "healthy" | "source_missing") {
                        ("ready", "可以删除软链接".into())
                    } else {
                        ("blocked", delete_block_message(&status))
                    };
                items.push(BatchPreviewItem {
                    source: source.clone(),
                    path: record.path,
                    status: preview_status.into(),
                    message,
                });
            }
        }
        Ok(BatchPreview { items })
    }

    pub fn batch_delete_links(
        &mut self,
        sources: Vec<String>,
        paths: Vec<String>,
    ) -> Result<BatchOperationResult, String> {
        self.snapshot()?;
        let mut items = Vec::new();
        let mut source_keys = Vec::with_capacity(sources.len());
        for source in sources {
            let source_key = match normalize_absolute_path(&source, "事实源路径") {
                Ok(path) => path,
                Err(error) => {
                    items.push(BatchOperationItem {
                        source,
                        path: String::new(),
                        success: false,
                        message: error,
                    });
                    continue;
                }
            };
            source_keys.push((source, source_key));
        }

        for requested_path in paths {
            let normalized_path = match canonical_link_path(Path::new(&requested_path)) {
                Ok(path) => path,
                Err(error) => {
                    items.push(BatchOperationItem {
                        source: String::new(),
                        path: requested_path,
                        success: false,
                        message: error,
                    });
                    continue;
                }
            };
            let record = self
                .registry
                .links
                .iter()
                .find(|record| paths_equal(&record.path, &normalized_path))
                .cloned();
            let Some(record) = record else {
                items.push(BatchOperationItem {
                    source: String::new(),
                    path: requested_path,
                    success: false,
                    message: "这条链接未纳入管理，请先刷新".into(),
                });
                continue;
            };
            let source = source_keys
                .iter()
                .find(|(_, source)| paths_equal(source, &record.target))
                .map(|(source, _)| source.clone());
            let Some(source) = source else {
                items.push(BatchOperationItem {
                    source: record.target,
                    path: record.path,
                    success: false,
                    message: "链接事实源不在本次批量删除范围内".into(),
                });
                continue;
            };
            let path = record.path.clone();
            match self.delete_link(&path) {
                Ok(_) => items.push(BatchOperationItem {
                    source,
                    path,
                    success: true,
                    message: "链接已删除，事实源保持不变".into(),
                }),
                Err(error) => items.push(BatchOperationItem {
                    source,
                    path,
                    success: false,
                    message: error,
                }),
            }
        }
        let snapshot = self.snapshot_after_mutation()?;
        Ok(BatchOperationResult { snapshot, items })
    }

    pub fn snapshot(&mut self) -> Result<Snapshot, String> {
        self.snapshot_inner(true)
    }

    fn snapshot_after_mutation(&mut self) -> Result<Snapshot, String> {
        match self.snapshot_inner(true) {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                let mut snapshot = self.snapshot_inner(false)?;
                snapshot
                    .scan_warnings
                    .push(format!("刷新扫描结果未能保存：{error}"));
                Ok(snapshot)
            }
        }
    }

    fn snapshot_inner(&mut self, persist_scan: bool) -> Result<Snapshot, String> {
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
                if is_quarantine_path(entry.path()) {
                    continue;
                }
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
                    .find(|item| paths_equal(&item.path, &link_path))
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
        if persist_scan && self.registry != before {
            if let Err(error) = self.save() {
                self.registry = before;
                return Err(error);
            }
        }
        let mut sources: BTreeMap<String, SourceView> = BTreeMap::new();
        for path in &self.registry.manual_sources {
            if let Some(source) = source_view_mut(&mut sources, path) {
                source.manual = true;
                continue;
            }
            sources.insert(
                path.clone(),
                SourceView {
                    path: path.clone(),
                    kind: source_kind(path),
                    manual: true,
                    tags: tags_for_path(&self.registry.tags, path),
                    links: Vec::new(),
                },
            );
        }
        for record in &self.registry.links {
            let source = match source_view_mut(&mut sources, &record.target) {
                Some(source) => source,
                None => {
                    sources.insert(
                        record.target.clone(),
                        SourceView {
                            path: record.target.clone(),
                            kind: source_kind(&record.target),
                            manual: false,
                            tags: tags_for_path(&self.registry.tags, &record.target),
                            links: Vec::new(),
                        },
                    );
                    sources.get_mut(&record.target).expect("刚插入事实源")
                }
            };
            source.links.push(LinkView {
                path: record.path.clone(),
                target: record.target.clone(),
                project: project_name(&record.path, &self.registry.roots),
                status: link_status(record),
            });
        }
        for path in self.registry.tags.keys().cloned().collect::<Vec<_>>() {
            if source_view_mut(&mut sources, &path).is_none() {
                sources.insert(
                    path.clone(),
                    SourceView {
                        path: path.clone(),
                        kind: source_kind(&path),
                        manual: false,
                        tags: tags_for_path(&self.registry.tags, &path),
                        links: Vec::new(),
                    },
                );
            }
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
            selected_source_path: None,
        })
    }
}

fn backup_path(config_path: &Path) -> io::Result<PathBuf> {
    let parent = config_path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "本地记录路径无效"))?;
    let name = config_path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "本地记录路径无效"))?
        .to_string_lossy();
    Ok(parent.join(format!("{name}.bak")))
}

fn write_delete_journal(config_path: &Path, journal: &DeleteJournal) -> Result<PathBuf, String> {
    let parent = config_path.parent().ok_or("本地记录路径无效")?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    let config_name = config_path
        .file_name()
        .ok_or("本地记录路径无效")?
        .to_string_lossy();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let journal_path = (0..1000u32)
        .map(|sequence| parent.join(format!("{config_name}.delete-{}-{stamp}-{sequence}.journal", std::process::id())))
        .find(|candidate| matches!(fs::symlink_metadata(candidate), Err(error) if error.kind() == io::ErrorKind::NotFound))
        .ok_or("无法生成唯一删除记录路径")?;
    let temporary = unique_sibling_path(&journal_path, ".tmp")
        .map_err(|error| format!("无法准备删除记录临时文件：{error}"))?;
    let bytes =
        serde_json::to_vec(journal).map_err(|error| format!("无法序列化删除记录：{error}"))?;
    let write_result = (|| -> io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, &journal_path)
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法保存删除记录：{error}"));
    }
    #[cfg(unix)]
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(journal_path)
}

fn recover_delete_journals(config_path: &Path, registry: &Registry) -> Result<(), String> {
    let parent = config_path.parent().ok_or("本地记录路径无效")?;
    let prefix = format!(
        "{}.delete-",
        config_path
            .file_name()
            .ok_or("本地记录路径无效")?
            .to_string_lossy()
    );
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
            ) =>
        {
            return Ok(());
        }
        Err(error) => return Err(format!("无法检查待恢复链接：{error}")),
    };
    for entry in entries {
        let entry = entry.map_err(|error| format!("无法检查待恢复链接：{error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(&prefix) || !name.ends_with(".journal") {
            continue;
        }
        let journal_path = entry.path();
        let bytes = fs::read(&journal_path)
            .map_err(|error| format!("无法读取删除记录 {}：{error}", display(&journal_path)))?;
        let journal: DeleteJournal = serde_json::from_slice(&bytes).map_err(|error| {
            format!(
                "删除记录 {} 已损坏，请人工检查：{error}",
                display(&journal_path)
            )
        })?;
        let original = Path::new(&journal.original);
        let quarantine = Path::new(&journal.quarantine);
        if !original.is_absolute()
            || !quarantine.is_absolute()
            || !original
                .parent()
                .zip(quarantine.parent())
                .is_some_and(|(left, right)| paths_equal(&display(left), &display(right)))
            || !is_quarantine_path(quarantine)
        {
            return Err(format!(
                "删除记录 {} 的路径无效，请人工检查",
                display(&journal_path)
            ));
        }
        let quarantined = match fs::symlink_metadata(quarantine) {
            Ok(metadata) if metadata.file_type().is_symlink() => true,
            Ok(_) => {
                return Err(format!(
                    "暂存位置 {} 已被其他文件占用，请人工检查",
                    journal.quarantine
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => false,
            Err(error) => return Err(format!("无法检查暂存链接 {}：{error}", journal.quarantine)),
        };
        if quarantined {
            let actual = read_target(quarantine)
                .map_err(|error| format!("无法检查暂存链接 {}：{error}", journal.quarantine))?;
            if !paths_equal(&display(&actual), &journal.target) {
                return Err(format!(
                    "暂存链接 {} 的目标已改变，请人工检查",
                    journal.quarantine
                ));
            }
            let record = registry
                .links
                .iter()
                .find(|record| paths_equal(&record.path, &journal.original));
            match record {
                Some(record) if paths_equal(&record.target, &journal.target) => {
                    match fs::symlink_metadata(original) {
                        Err(error) if error.kind() == io::ErrorKind::NotFound => {
                            fs::rename(quarantine, original).map_err(|error| {
                                format!("无法恢复软链接 {}：{error}", journal.original)
                            })?;
                        }
                        Ok(_) => {
                            return Err(format!(
                                "链接位置 {} 已被占用，请人工检查暂存链接",
                                journal.original
                            ))
                        }
                        Err(error) => {
                            return Err(format!("无法检查链接位置 {}：{error}", journal.original))
                        }
                    }
                }
                Some(_) => {
                    return Err(format!(
                        "链接记录 {} 已改变，请人工检查暂存链接",
                        journal.original
                    ))
                }
                None => remove_os_link(quarantine).map_err(|error| {
                    format!("无法完成删除暂存链接 {}：{error}", journal.quarantine)
                })?,
            }
        }
        fs::remove_file(&journal_path)
            .map_err(|error| format!("无法清理删除记录 {}：{error}", display(&journal_path)))?;
    }
    Ok(())
}

fn restore_primary_from_backup(backup: &Path, config_path: &Path) -> io::Result<()> {
    let temporary = unique_sibling_path(config_path, ".restore")?;
    if let Err(error) = fs::copy(backup, &temporary) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temporary, config_path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn unique_sibling_path(path: &Path, marker: &str) -> io::Result<PathBuf> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "路径无效"))?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "路径无效"))?
        .to_string_lossy();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let process = std::process::id();
    for sequence in 0..1000u32 {
        let candidate = parent.join(format!("{name}{marker}-{process}-{stamp}-{sequence}"));
        match fs::symlink_metadata(&candidate) {
            Ok(_) => continue,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(candidate),
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "无法生成唯一临时路径",
    ))
}

fn unique_quarantine_path(link_path: &Path) -> io::Result<PathBuf> {
    let parent = link_path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "链接路径无效"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let process = std::process::id();
    for sequence in 0..1000u32 {
        let candidate = parent.join(format!("{QUARANTINE_PREFIX}{process}-{stamp}-{sequence}"));
        match fs::symlink_metadata(&candidate) {
            Ok(_) => continue,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(candidate),
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "无法生成唯一链接暂存路径",
    ))
}

fn is_quarantine_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(QUARANTINE_PREFIX))
}

#[cfg(windows)]
fn path_key(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

// A conservative identity on macOS also protects the common case-insensitive volume.
// Case-sensitive macOS volumes may reject a pair of names that differs only by case.
#[cfg(target_os = "macos")]
fn path_key(path: &str) -> String {
    path.to_lowercase()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn path_key(path: &str) -> String {
    path.to_owned()
}

fn paths_equal(left: &str, right: &str) -> bool {
    path_key(left) == path_key(right)
}

fn path_starts_with(path: &str, root: &str) -> bool {
    #[cfg(windows)]
    {
        let path = path_key(path);
        let root = path_key(root);
        let root_without_separator = root.trim_end_matches('\\');
        path == root || path.starts_with(&(root_without_separator.to_owned() + "\\"))
    }
    #[cfg(target_os = "macos")]
    {
        let path = path_key(path);
        let root = path_key(root);
        path == root || path.starts_with(&(root.trim_end_matches('/').to_owned() + "/"))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Path::new(path).starts_with(Path::new(root))
    }
}

fn tags_for_path(tags: &BTreeMap<String, Vec<String>>, path: &str) -> Vec<String> {
    tags.iter()
        .find(|(key, _)| paths_equal(key, path))
        .map(|(_, value)| value.clone())
        .unwrap_or_default()
}

fn source_view_mut<'a>(
    sources: &'a mut BTreeMap<String, SourceView>,
    path: &str,
) -> Option<&'a mut SourceView> {
    let key = sources.keys().find(|key| paths_equal(key, path)).cloned()?;
    sources.get_mut(&key)
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = tag.trim();
        if !tag.is_empty() && !normalized.iter().any(|item| item == tag) {
            normalized.push(tag.to_owned());
        }
    }
    normalized
}

fn validate_expected_kind(expected_kind: Option<&str>, is_dir: bool) -> Result<(), String> {
    let Some(expected_kind) = expected_kind else {
        return Ok(());
    };
    let expected_is_dir = match expected_kind {
        "file" => false,
        "directory" => true,
        _ => return Err("expectedKind 必须是 file 或 directory".into()),
    };
    if expected_is_dir == is_dir {
        return Ok(());
    }
    if expected_is_dir {
        Err("所选路径是文件，请选择文件夹".into())
    } else {
        Err("所选路径是文件夹，请选择文件".into())
    }
}

fn validate_existing_source(path: &str) -> Result<(PathBuf, bool), String> {
    let original = Path::new(path);
    if !original.is_absolute() {
        return Err("事实源路径必须是已存在的绝对路径".into());
    }
    let metadata =
        fs::symlink_metadata(original).map_err(|error| format!("事实源不可用：{error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("请选择原始文件或文件夹，而不是另一条软链接".into());
    }
    if !metadata.is_file() && !metadata.is_dir() {
        return Err("事实源必须是普通文件或文件夹".into());
    }
    let canonical = original
        .canonicalize()
        .map_err(|error| format!("事实源不可用：{error}"))?;
    Ok((canonical, metadata.is_dir()))
}

fn validate_existing_folder(path: &str, label: &str) -> Result<PathBuf, String> {
    let original = Path::new(path);
    if !original.is_absolute() {
        return Err(format!("{label}路径必须是已存在的绝对路径"));
    }
    fs::symlink_metadata(original).map_err(|error| format!("{label}不可用：{error}"))?;
    let metadata = fs::metadata(original).map_err(|error| format!("{label}不可用：{error}"))?;
    if !metadata.is_dir() {
        return Err(format!("{label}必须是文件夹"));
    }
    let canonical = original
        .canonicalize()
        .map_err(|error| format!("{label}不可用：{error}"))?;
    Ok(canonical)
}

fn normalize_absolute_path(path: &str, label: &str) -> Result<String, String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(format!("{label}必须是绝对路径"));
    }
    Ok(display(&normalize_path_preserving_final(path)))
}

fn normalize_path_preserving_final(path: &Path) -> PathBuf {
    let Some(name) = path.file_name() else {
        return normalize_target(path);
    };
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    normalize_target(parent).join(name)
}

fn source_basename(path: &Path) -> Option<&str> {
    path.file_name().and_then(|name| name.to_str())
}

fn batch_candidate_path(folder: &str, name: Option<&str>) -> String {
    let Some(name) = name else {
        return String::new();
    };
    if let Ok(folder) = validate_existing_folder(folder, "目标文件夹") {
        return display(&folder.join(name));
    }
    display(&Path::new(folder).join(name))
}

fn delete_block_message(status: &str) -> String {
    match status {
        "link_missing" => "链接已不存在，未进行删除".into(),
        "replaced" => "此位置现在不是软链接，已停止删除；请先检查该文件".into(),
        "retargeted" => "链接目标已改变，已停止删除；请先刷新并检查".into(),
        _ => "链接无法安全删除，请先检查该位置".into(),
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

#[cfg(test)]
fn canonical_string(path: &Path) -> Result<String, String> {
    path.canonicalize()
        .map(|canonical| display(&canonical))
        .map_err(|error| format!("无法定位事实源：{error}"))
}

fn canonical_link_path(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("链接路径必须是绝对路径".into());
    }
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
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => "symlink".into(),
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
            Ok(target) if !paths_equal(&display(&target), &record.target) => "retargeted".into(),
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
        .filter(|root| path_starts_with(path, root))
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
    if error.kind() == io::ErrorKind::PermissionDenied
        || cfg!(windows) && error.raw_os_error() == Some(1314)
    {
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

    #[cfg(unix)]
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

    #[cfg(unix)]
    #[test]
    fn recreating_a_missing_link_replaces_its_old_record() {
        let temp = TempDir::new().unwrap();
        let first = temp.path().join("first.md");
        let second = temp.path().join("second.md");
        let project = temp.path().join("project");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        fs::create_dir(&project).unwrap();
        let mut core = app(&temp);
        core.create_link(
            first.to_str().unwrap(),
            project.to_str().unwrap(),
            "shared.md",
        )
        .unwrap();
        fs::remove_file(project.join("shared.md")).unwrap();

        let snapshot = core
            .create_link(
                second.to_str().unwrap(),
                project.to_str().unwrap(),
                "shared.md",
            )
            .unwrap();
        assert_eq!(core.registry.links.len(), 1);
        assert_eq!(
            core.registry.links[0].target,
            canonical_string(&second).unwrap()
        );
        assert_eq!(
            snapshot
                .sources
                .iter()
                .map(|source| source.links.len())
                .sum::<usize>(),
            1
        );
        assert_eq!(fs::read_to_string(&first).unwrap(), "first");
    }

    #[cfg(unix)]
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

    #[cfg(unix)]
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
    fn registry_save_failure_rolls_back_mutation_in_memory() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let blocked_parent = temp.path().join("blocked");
        fs::write(&source, "text").unwrap();
        fs::write(&blocked_parent, "not a directory").unwrap();

        let config = blocked_parent.join("registry.json");
        let mut core = AppCore::open(config).unwrap();
        let error = core.add_source(source.to_str().unwrap()).unwrap_err();
        assert!(error.contains("应用数据目录") || error.contains("本地记录"));
        assert!(core.registry.manual_sources.is_empty());
        assert!(core.snapshot().unwrap().sources.is_empty());
    }

    #[test]
    fn opening_with_missing_primary_uses_and_restores_backup() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let config = temp.path().join("app/registry.json");
        fs::write(&source, "text").unwrap();
        let source = canonical_string(&source).unwrap();
        let mut core = AppCore::open(config.clone()).unwrap();
        core.add_source(&source).unwrap();
        core.set_source_tags(&source, vec!["newer".into()]).unwrap();

        let backup = backup_path(&config).unwrap();
        assert!(backup.is_file());
        fs::remove_file(&config).unwrap();

        let mut reopened = AppCore::open(config.clone()).unwrap();
        let snapshot = reopened.snapshot().unwrap();
        assert!(config.is_file());
        assert_eq!(snapshot.sources[0].path, source);
        assert!(snapshot.sources[0].manual);
    }

    #[test]
    fn opening_with_corrupt_primary_restores_backup_and_preserves_corrupt_file() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let config = temp.path().join("app/registry.json");
        fs::write(&source, "text").unwrap();
        let mut core = AppCore::open(config.clone()).unwrap();
        core.add_source(source.to_str().unwrap()).unwrap();
        core.set_source_tags(source.to_str().unwrap(), vec!["newer".into()])
            .unwrap();
        fs::write(&config, "{broken").unwrap();

        let mut reopened = AppCore::open(config.clone()).unwrap();
        assert_eq!(reopened.snapshot().unwrap().sources.len(), 1);
        assert!(serde_json::from_slice::<Registry>(&fs::read(&config).unwrap()).is_ok());
        let preserved = fs::read_dir(config.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("registry.json.corrupt-")
            });
        assert!(preserved);
    }

    #[test]
    fn journal_before_link_move_is_cleared_without_touching_source() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        fs::write(&source, "source").unwrap();
        fs::create_dir(&project).unwrap();
        let config = temp.path().join("app/registry.json");
        let journal_path = write_delete_journal(
            &config,
            &DeleteJournal {
                original: display(&project.join("linked.md")),
                quarantine: display(&project.join(".softconnet-quarantine-test")),
                target: display(&source),
            },
        )
        .unwrap();

        AppCore::open(config).unwrap();
        assert!(!journal_path.exists());
        assert_eq!(fs::read_to_string(source).unwrap(), "source");
    }

    #[test]
    fn journal_recovery_refuses_to_delete_a_non_link_quarantine() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        fs::write(&source, "source").unwrap();
        fs::create_dir(&project).unwrap();
        let quarantine = project.join(".softconnet-quarantine-test");
        fs::write(&quarantine, "keep").unwrap();
        let config = temp.path().join("app/registry.json");
        let journal_path = write_delete_journal(
            &config,
            &DeleteJournal {
                original: display(&project.join("linked.md")),
                quarantine: display(&quarantine),
                target: display(&source),
            },
        )
        .unwrap();

        assert!(AppCore::open(config).is_err());
        assert!(journal_path.exists());
        assert_eq!(fs::read_to_string(quarantine).unwrap(), "keep");
        assert_eq!(fs::read_to_string(source).unwrap(), "source");
    }

    #[cfg(unix)]
    #[test]
    fn interrupted_delete_before_registry_save_restores_original_link() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        fs::write(&source, "source").unwrap();
        fs::create_dir(&project).unwrap();
        let config = temp.path().join("app/registry.json");
        let mut core = AppCore::open(config.clone()).unwrap();
        core.create_link(
            source.to_str().unwrap(),
            project.to_str().unwrap(),
            "linked.md",
        )
        .unwrap();
        let original = project.join("linked.md");
        let quarantine = unique_quarantine_path(&original).unwrap();
        let journal_path = write_delete_journal(
            &config,
            &DeleteJournal {
                original: display(&original),
                quarantine: display(&quarantine),
                target: core.registry.links[0].target.clone(),
            },
        )
        .unwrap();
        fs::rename(&original, &quarantine).unwrap();
        drop(core);

        let mut reopened = AppCore::open(config).unwrap();
        assert_eq!(reopened.snapshot().unwrap().sources[0].links.len(), 1);
        assert!(original
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!quarantine.exists());
        assert!(!journal_path.exists());
        assert_eq!(fs::read_to_string(source).unwrap(), "source");
    }

    #[cfg(unix)]
    #[test]
    fn interrupted_delete_after_registry_save_finishes_quarantine_cleanup() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        fs::write(&source, "source").unwrap();
        fs::create_dir(&project).unwrap();
        let config = temp.path().join("app/registry.json");
        let mut core = AppCore::open(config.clone()).unwrap();
        core.create_link(
            source.to_str().unwrap(),
            project.to_str().unwrap(),
            "linked.md",
        )
        .unwrap();
        let original = project.join("linked.md");
        let quarantine = unique_quarantine_path(&original).unwrap();
        let journal_path = write_delete_journal(
            &config,
            &DeleteJournal {
                original: display(&original),
                quarantine: display(&quarantine),
                target: core.registry.links[0].target.clone(),
            },
        )
        .unwrap();
        fs::rename(&original, &quarantine).unwrap();
        core.registry.links.clear();
        core.save().unwrap();
        drop(core);

        let mut reopened = AppCore::open(config).unwrap();
        assert!(reopened.snapshot().unwrap().sources.is_empty());
        assert!(!original.exists());
        assert!(!quarantine.exists());
        assert!(!journal_path.exists());
        assert_eq!(fs::read_to_string(source).unwrap(), "source");
    }

    #[test]
    fn add_source_reports_canonical_path_for_alias_input() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let nested = temp.path().join("nested");
        fs::write(&source, "text").unwrap();
        fs::create_dir(&nested).unwrap();
        let alias = nested.join("..").join("source.md");
        let snapshot = app(&temp).add_source(alias.to_str().unwrap()).unwrap();
        assert_eq!(
            snapshot.selected_source_path,
            Some(canonical_string(&source).unwrap())
        );
    }

    #[test]
    fn old_registry_without_tags_is_compatible() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let config = temp.path().join("app/registry.json");
        fs::write(&source, "text").unwrap();
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(
            &config,
            serde_json::json!({
                "roots": [],
                "manual_sources": [canonical_string(&source).unwrap()],
                "links": []
            })
            .to_string(),
        )
        .unwrap();

        let mut core = AppCore::open(config).unwrap();
        let snapshot = core.snapshot().unwrap();
        assert_eq!(snapshot.sources[0].tags, Vec::<String>::new());
    }

    #[test]
    fn source_tags_persist_and_forget_clears_them_without_links() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        fs::write(&source, "text").unwrap();
        let config = temp.path().join("app/registry.json");
        let source = canonical_string(&source).unwrap();
        let mut core = AppCore::open(config.clone()).unwrap();
        core.add_source(&source).unwrap();
        let snapshot = core
            .set_source_tags(&source, vec!["work".into(), " work ".into(), "".into()])
            .unwrap();
        assert_eq!(snapshot.sources[0].tags, vec!["work"]);

        let mut reopened = AppCore::open(config.clone()).unwrap();
        assert_eq!(reopened.snapshot().unwrap().sources[0].tags, vec!["work"]);
        reopened.forget_source(&source).unwrap();
        let saved = fs::read_to_string(config).unwrap();
        assert!(!saved.contains("work"));
    }

    #[test]
    fn source_tags_allow_known_missing_sources_but_reject_unknown_paths() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let unknown = temp.path().join("unknown.md");
        fs::write(&source, "text").unwrap();
        let source = canonical_string(&source).unwrap();
        let mut core = app(&temp);
        core.add_source(&source).unwrap();
        fs::remove_file(&source).unwrap();

        let snapshot = core
            .set_source_tags(&source, vec!["offline".into()])
            .unwrap();
        assert_eq!(snapshot.sources[0].kind, "missing");
        assert_eq!(snapshot.sources[0].tags, vec!["offline"]);
        assert!(core
            .set_source_tags(unknown.to_str().unwrap(), vec!["unknown".into()])
            .unwrap_err()
            .contains("尚未纳入管理"));
    }

    #[test]
    fn add_source_expected_kind_rejects_mismatches_without_persisting() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let folder = temp.path().join("folder");
        fs::write(&source, "text").unwrap();
        fs::create_dir(&folder).unwrap();
        let mut core = app(&temp);

        assert!(core
            .add_source_with_kind(source.to_str().unwrap(), Some("directory"))
            .unwrap_err()
            .contains("文件夹"));
        assert!(core
            .add_source_with_kind(folder.to_str().unwrap(), Some("file"))
            .unwrap_err()
            .contains("文件"));
        assert!(core
            .add_source_with_kind(source.to_str().unwrap(), Some("other"))
            .unwrap_err()
            .contains("expectedKind"));
        assert!(core.snapshot().unwrap().sources.is_empty());

        core.add_source_with_kind(source.to_str().unwrap(), Some("file"))
            .unwrap();
        core.add_source_with_kind(folder.to_str().unwrap(), Some("directory"))
            .unwrap();
        assert_eq!(core.snapshot().unwrap().sources.len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn scanned_source_can_receive_persistent_tags() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(&source, "text").unwrap();
        create_os_link(&source, &project.join("shared.md"), false).unwrap();
        let config = temp.path().join("app/registry.json");
        let source = canonical_string(&source).unwrap();
        let mut core = AppCore::open(config.clone()).unwrap();
        let scanned = core.add_root(project.to_str().unwrap()).unwrap();
        assert!(!scanned.sources[0].manual);
        core.set_source_tags(&source, vec!["shared".into()])
            .unwrap();

        let mut reopened = AppCore::open(config).unwrap();
        let snapshot = reopened.snapshot().unwrap();
        assert_eq!(snapshot.sources[0].path, source);
        assert_eq!(snapshot.sources[0].tags, vec!["shared"]);
        assert!(!snapshot.sources[0].manual);

        let after_root_removal = reopened.remove_root(project.to_str().unwrap()).unwrap();
        assert_eq!(after_root_removal.sources.len(), 1);
        assert_eq!(after_root_removal.sources[0].path, source);
        assert_eq!(after_root_removal.sources[0].tags, vec!["shared"]);
        assert!(after_root_removal.sources[0].links.is_empty());
        assert!(!after_root_removal.sources[0].manual);
        assert!(reopened
            .set_source_tags(&source, Vec::new())
            .unwrap()
            .sources
            .is_empty());
    }

    #[test]
    fn tagged_source_without_links_can_change_and_clear_tags() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        fs::write(&source, "text").unwrap();
        let source = canonical_string(&source).unwrap();
        let mut core = app(&temp);
        core.registry
            .tags
            .insert(source.clone(), vec!["old".into()]);
        core.save().unwrap();

        let changed = core.set_source_tags(&source, vec!["new".into()]).unwrap();
        assert_eq!(changed.sources[0].tags, vec!["new"]);
        let cleared = core.set_source_tags(&source, Vec::new()).unwrap();
        assert!(cleared.sources.is_empty());
    }

    #[test]
    fn hand_entered_paths_must_be_absolute_and_have_the_expected_type() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        fs::write(&source, "text").unwrap();
        fs::create_dir(&project).unwrap();
        let mut core = app(&temp);
        assert!(core
            .add_source("source.md")
            .unwrap_err()
            .contains("绝对路径"));
        assert!(core.add_root(source.to_str().unwrap()).is_err());
        assert!(core
            .create_link(source.to_str().unwrap(), "project", "linked.md")
            .unwrap_err()
            .contains("绝对路径"));
        assert!(core
            .set_source_tags("missing.md", vec!["tag".into()])
            .unwrap_err()
            .contains("绝对路径"));
    }

    #[test]
    fn batch_preview_reports_occupied_targets() {
        let temp = TempDir::new().unwrap();
        let source_a = temp.path().join("a.md");
        let source_b = temp.path().join("b.md");
        let project = temp.path().join("project");
        fs::write(&source_a, "a").unwrap();
        fs::write(&source_b, "b").unwrap();
        fs::create_dir(&project).unwrap();
        fs::write(project.join("a.md"), "occupied").unwrap();
        let mut core = app(&temp);
        let preview = core
            .preview_batch_create(
                vec![
                    source_a.to_str().unwrap().into(),
                    source_b.to_str().unwrap().into(),
                ],
                project.to_str().unwrap().into(),
            )
            .unwrap();
        assert_eq!(preview.items.len(), 2);
        assert_eq!(preview.items[0].status, "blocked");
        assert!(preview.items[0].message.contains("未进行覆盖"));
        assert_eq!(preview.items[1].status, "ready");
    }

    #[test]
    fn batch_create_rejects_duplicate_targets_before_creating_any_link() {
        let temp = TempDir::new().unwrap();
        let left = temp.path().join("left");
        let right = temp.path().join("right");
        let project = temp.path().join("project");
        fs::create_dir(&left).unwrap();
        fs::create_dir(&right).unwrap();
        fs::create_dir(&project).unwrap();
        let source_a = left.join("shared.md");
        let source_b = right.join("shared.md");
        fs::write(&source_a, "a").unwrap();
        fs::write(&source_b, "b").unwrap();
        let mut core = app(&temp);

        let result = core
            .batch_create_links(
                vec![
                    source_a.to_str().unwrap().into(),
                    source_b.to_str().unwrap().into(),
                ],
                project.to_str().unwrap().into(),
            )
            .unwrap();
        assert_eq!(result.items.len(), 2);
        assert!(result.items.iter().all(|item| !item.success));
        assert!(result
            .items
            .iter()
            .all(|item| item.message.contains("同名目标")));
        assert!(!project.join("shared.md").exists());
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn batch_create_detects_same_name_targets_without_case_sensitivity() {
        let temp = TempDir::new().unwrap();
        let left = temp.path().join("left");
        let right = temp.path().join("right");
        let project = temp.path().join("project");
        fs::create_dir(&left).unwrap();
        fs::create_dir(&right).unwrap();
        fs::create_dir(&project).unwrap();
        let source_a = left.join("Shared.md");
        let source_b = right.join("shared.md");
        fs::write(&source_a, "a").unwrap();
        fs::write(&source_b, "b").unwrap();
        let mut core = app(&temp);

        let result = core
            .batch_create_links(
                vec![
                    source_a.to_str().unwrap().into(),
                    source_b.to_str().unwrap().into(),
                ],
                project.to_str().unwrap().into(),
            )
            .unwrap();
        assert!(result.items.iter().all(|item| !item.success));
        assert!(result
            .items
            .iter()
            .all(|item| item.message.contains("同名目标")));
    }

    #[cfg(unix)]
    #[test]
    fn batch_create_reports_partial_success() {
        let temp = TempDir::new().unwrap();
        let source_a = temp.path().join("a.md");
        let source_b = temp.path().join("b.md");
        let project = temp.path().join("project");
        fs::write(&source_a, "a").unwrap();
        fs::write(&source_b, "b").unwrap();
        fs::create_dir(&project).unwrap();
        fs::write(project.join("a.md"), "occupied").unwrap();
        let mut core = app(&temp);
        let result = core
            .batch_create_links(
                vec![
                    source_a.to_str().unwrap().into(),
                    source_b.to_str().unwrap().into(),
                ],
                project.to_str().unwrap().into(),
            )
            .unwrap();
        assert!(!result.items[0].success);
        assert!(result.items[1].success);
        assert!(project.join("a.md").is_file());
        assert!(project
            .join("b.md")
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(&source_b).unwrap(), "b");
    }

    #[cfg(unix)]
    #[test]
    fn batch_delete_refuses_retargeted_links() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let other = temp.path().join("other.md");
        let project = temp.path().join("project");
        let link = project.join("shared.md");
        fs::write(&source, "source").unwrap();
        fs::write(&other, "other").unwrap();
        fs::create_dir(&project).unwrap();
        let mut core = app(&temp);
        core.create_link(
            source.to_str().unwrap(),
            project.to_str().unwrap(),
            "shared.md",
        )
        .unwrap();
        fs::remove_file(&link).unwrap();
        create_os_link(&other, &link, false).unwrap();

        let preview = core
            .preview_batch_delete(vec![source.to_str().unwrap().into()])
            .unwrap();
        assert_eq!(preview.items.len(), 1);
        assert_eq!(preview.items[0].status, "blocked");
        assert!(preview.items[0].message.contains("目标已改变"));
        let result = core
            .batch_delete_links(
                vec![source.to_str().unwrap().into()],
                vec![link.to_str().unwrap().into()],
            )
            .unwrap();
        assert!(!result.items[0].success);
        assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&source).unwrap(), "source");
    }

    #[cfg(unix)]
    #[test]
    fn delete_link_save_failure_restores_registry_and_link() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        let config = temp.path().join("app/registry.json");
        let link = project.join("linked.md");
        fs::write(&source, "source").unwrap();
        fs::create_dir(&project).unwrap();
        let mut core = app(&temp);
        core.create_link(
            source.to_str().unwrap(),
            project.to_str().unwrap(),
            "linked.md",
        )
        .unwrap();
        fs::rename(&config, config.with_extension("saved")).unwrap();
        fs::create_dir(&config).unwrap();

        assert!(core.delete_link(link.to_str().unwrap()).is_err());
        assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(core.registry.links.len(), 1);
        assert_eq!(fs::read_to_string(&source).unwrap(), "source");
        let quarantine_count = fs::read_dir(&project)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| is_quarantine_path(&entry.path()))
            .count();
        assert_eq!(quarantine_count, 0);
        let journal_count = fs::read_dir(config.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".journal"))
            .count();
        assert_eq!(journal_count, 0);
    }

    #[cfg(unix)]
    #[test]
    fn clearing_tags_keeps_managed_identity_when_source_is_replaced_by_symlink() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let replacement = temp.path().join("replacement.md");
        fs::write(&source, "source").unwrap();
        fs::write(&replacement, "replacement").unwrap();
        let mut core = app(&temp);
        core.add_source(source.to_str().unwrap()).unwrap();
        core.set_source_tags(source.to_str().unwrap(), vec!["work".into()])
            .unwrap();
        fs::remove_file(&source).unwrap();
        create_os_link(&replacement, &source, false).unwrap();

        let snapshot = core
            .set_source_tags(source.to_str().unwrap(), Vec::new())
            .unwrap();
        assert_eq!(snapshot.sources.len(), 1);
        assert_eq!(snapshot.sources[0].kind, "symlink");
        assert!(snapshot.sources[0].tags.is_empty());
        assert!(source.symlink_metadata().unwrap().file_type().is_symlink());
        assert!(core.registry.tags.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn batch_delete_only_attempts_paths_from_the_preview() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.md");
        let project = temp.path().join("project");
        let first = project.join("first.md");
        let second = project.join("second.md");
        fs::write(&source, "source").unwrap();
        fs::create_dir(&project).unwrap();
        create_os_link(&source, &first, false).unwrap();
        let mut core = app(&temp);
        core.add_root(project.to_str().unwrap()).unwrap();
        let preview = core
            .preview_batch_delete(vec![source.to_str().unwrap().into()])
            .unwrap();
        assert_eq!(preview.items.len(), 1);
        create_os_link(&source, &second, false).unwrap();

        let result = core
            .batch_delete_links(
                vec![source.to_str().unwrap().into()],
                vec![preview.items[0].path.clone()],
            )
            .unwrap();
        assert_eq!(result.items.len(), 1);
        assert!(result.items[0].success);
        assert!(!first.exists());
        assert!(second.symlink_metadata().unwrap().file_type().is_symlink());
    }

    #[test]
    fn permission_error_has_actionable_message() {
        let error = io::Error::from(io::ErrorKind::PermissionDenied);
        let message = format_create_error(&error);
        assert!(message.contains("权限"));
        #[cfg(windows)]
        assert!(format_create_error(&io::Error::from_raw_os_error(1314)).contains("开发者模式"));
    }

    #[cfg(unix)]
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

    #[cfg(unix)]
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

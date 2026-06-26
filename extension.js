const vscode = require('vscode')
const fs = require('fs')
const path = require('path')

const CONFIG_SECTION = 'dotFolderGroup'
const MANAGED_PATTERNS_KEY = 'managedExcludePatterns'

function getConfig() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION)
}

function isExtensionEnabled() {
  return getConfig().get('enabled', true)
}

function shouldHideInExplorer() {
  return getConfig().get('hideInExplorer', true)
}

function getExcludeSet() {
  return new Set(getConfig().get('exclude', ['.git']))
}

async function listDotFoldersAtRoot(workspaceFolder) {
  const rootPath = workspaceFolder.uri.fsPath
  const exclude = getExcludeSet()

  let entries = []

  try {
    entries = await fs.promises.readdir(rootPath, { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.') && !exclude.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(rootPath, entry.name),
      workspaceFolder
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

class DotFolderTreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState, options = {}) {
    super(label, collapsibleState)
    this.kind = options.kind || 'entry'
    this.entryPath = options.entryPath
    this.workspaceFolder = options.workspaceFolder

    if (options.entryPath) {
      this.resourceUri = vscode.Uri.file(options.entryPath)
    }

    if (options.kind === 'group') {
      this.iconPath = new vscode.ThemeIcon('folder-library')
      this.contextValue = 'dotFolderGroup.group'
    } else if (options.kind === 'dot-root') {
      this.iconPath = new vscode.ThemeIcon('folder')
      this.contextValue = 'dotFolderGroup.dotRoot'
    } else if (options.kind === 'folder') {
      this.iconPath = new vscode.ThemeIcon('folder')
      this.contextValue = 'dotFolderGroup.folder'
    } else {
      this.iconPath = new vscode.ThemeIcon('file')
      this.contextValue = 'dotFolderGroup.file'
    }
  }
}

class DotFolderTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter()
    this.onDidChangeTreeData = this._onDidChangeTreeData.event
    this._dotFolders = []
  }

  get dotFolders() {
    return this._dotFolders
  }

  refresh() {
    this._onDidChangeTreeData.fire()
  }

  async reloadDotFolders() {
    const folders = vscode.workspace.workspaceFolders || []
    const dotFolders = []

    for (const workspaceFolder of folders) {
      const entries = await listDotFoldersAtRoot(workspaceFolder)
      dotFolders.push(...entries)
    }

    this._dotFolders = dotFolders
    await vscode.commands.executeCommand('setContext', 'dotFolderGroup.hasFolders', dotFolders.length > 0)
    return dotFolders
  }

  getTreeItem(element) {
    return element
  }

  async getChildren(element) {
    if (!isExtensionEnabled()) {
      return []
    }

    if (!element) {
      await this.reloadDotFolders()

      if (this._dotFolders.length === 0) {
        return []
      }

      const groupLabel = getConfig().get('groupLabel', '.')
      const groupItem = new DotFolderTreeItem(groupLabel, vscode.TreeItemCollapsibleState.Expanded, {
        kind: 'group'
      })

      return [groupItem]
    }

    if (element.kind === 'group') {
      return this._dotFolders.map(
        (folder) =>
          new DotFolderTreeItem(folder.name, vscode.TreeItemCollapsibleState.Collapsed, {
            kind: 'dot-root',
            entryPath: folder.path,
            workspaceFolder: folder.workspaceFolder
          })
      )
    }

    if (!element.entryPath) {
      return []
    }

    return this._readDirectoryChildren(element.entryPath, element.workspaceFolder)
  }

  async _readDirectoryChildren(directoryPath, workspaceFolder) {
    let entries = []

    try {
      entries = await fs.promises.readdir(directoryPath, { withFileTypes: true })
    } catch {
      return []
    }

    return entries
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })
      .map((entry) => {
        const entryPath = path.join(directoryPath, entry.name)
        const isDirectory = entry.isDirectory()

        return new DotFolderTreeItem(entry.name, isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, {
          kind: isDirectory ? 'folder' : 'file',
          entryPath,
          workspaceFolder
        })
      })
  }
}

function getManagedPatterns(context) {
  return context.workspaceState.get(MANAGED_PATTERNS_KEY, []) || []
}

function excludeMapsAreEqual(a, b) {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)

  if (aKeys.length !== bKeys.length) {
    return false
  }

  return aKeys.every((key) => a[key] === b[key])
}

async function writeExcludeIfChanged(currentExclude, nextExclude) {
  if (excludeMapsAreEqual(currentExclude, nextExclude)) {
    return false
  }

  const filesConfig = vscode.workspace.getConfiguration('files')
  await filesConfig.update('exclude', nextExclude, vscode.ConfigurationTarget.Workspace)
  return true
}

async function applyExplorerHiding(context, dotFolders) {
  const filesConfig = vscode.workspace.getConfiguration('files')
  const currentExclude = filesConfig.get('exclude', {})
  const managedPatterns = getManagedPatterns(context)
  const nextExclude = { ...currentExclude }

  for (const pattern of managedPatterns) {
    delete nextExclude[pattern]
  }

  const newManagedPatterns = []

  if (isExtensionEnabled() && shouldHideInExplorer()) {
    for (const folder of dotFolders) {
      nextExclude[folder.name] = true
      newManagedPatterns.push(folder.name)
    }
  }

  await context.workspaceState.update(MANAGED_PATTERNS_KEY, newManagedPatterns)
  await writeExcludeIfChanged(currentExclude, nextExclude)
}

async function removeManagedHiding(context, knownDotFolders = []) {
  const filesConfig = vscode.workspace.getConfiguration('files')
  const currentExclude = filesConfig.get('exclude', {})
  const nextExclude = { ...currentExclude }

  const patternsToRemove = new Set([
    ...getManagedPatterns(context),
    ...knownDotFolders.map((folder) => folder.name)
  ])

  for (const pattern of patternsToRemove) {
    delete nextExclude[pattern]
  }

  await context.workspaceState.update(MANAGED_PATTERNS_KEY, [])
  await writeExcludeIfChanged(currentExclude, nextExclude)
}

async function refreshAll(provider, context) {
  const dotFolders = await provider.reloadDotFolders()
  await applyExplorerHiding(context, dotFolders)
  provider.refresh()
}

function isRootLevelDotEntry(uri) {
  const folders = vscode.workspace.workspaceFolders || []

  return folders.some((workspaceFolder) => {
    const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
    return relativePath.startsWith('.') && !relativePath.includes(path.sep)
  })
}

let extensionContext = null
let treeProvider = null

function activate(context) {
  extensionContext = context

  const provider = new DotFolderTreeProvider()
  treeProvider = provider

  const treeView = vscode.window.createTreeView('dotFolderGroup.explorer', {
    treeDataProvider: provider,
    showCollapseAll: true
  })

  const toggleHideCommand = vscode.commands.registerCommand('dotFolderGroup.toggleHide', async () => {
    const nextValue = !shouldHideInExplorer()
    await getConfig().update('hideInExplorer', nextValue, vscode.ConfigurationTarget.Workspace)
    await refreshAll(provider, context)
    vscode.window.showInformationMessage(
      nextValue ? 'Dot-folders hidden from the default Explorer' : 'Dot-folders visible in the default Explorer'
    )
  })

  const restoreExplorerCommand = vscode.commands.registerCommand('dotFolderGroup.restoreExplorer', async () => {
    await getConfig().update('hideInExplorer', false, vscode.ConfigurationTarget.Workspace)
    await removeManagedHiding(context, provider.dotFolders)
    provider.refresh()
    vscode.window.showInformationMessage(
      'Dot-folders restored to the default Explorer. Use "Toggle Hide" to hide them again, or uninstall safely now.'
    )
  })

  const revealInGroupCommand = vscode.commands.registerCommand('dotFolderGroup.revealInGroup', async (resource) => {
    if (!resource) {
      return
    }

    const resourcePath = resource.fsPath || resource.path
    const folderName = path.basename(resourcePath)

    if (!folderName.startsWith('.')) {
      return
    }

    await treeView.show(true)
    const dotRoots = await provider.reloadDotFolders()
    const match = dotRoots.find((entry) => entry.name === folderName)

    if (match) {
      const item = new DotFolderTreeItem(match.name, vscode.TreeItemCollapsibleState.Collapsed, {
        kind: 'dot-root',
        entryPath: match.path,
        workspaceFolder: match.workspaceFolder
      })
      await treeView.reveal(item, { expand: true, focus: true, select: true })
    }
  })

  const refreshCommand = vscode.commands.registerCommand('dotFolderGroup.refresh', () => refreshAll(provider, context))

  const workspaceFoldersListener = vscode.workspace.onDidChangeWorkspaceFolders(() => refreshAll(provider, context))

  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONFIG_SECTION)) {
      vscode.commands.executeCommand('setContext', 'dotFolderGroup.enabled', isExtensionEnabled())
      refreshAll(provider, context)
    }
  })

  const watcher = vscode.workspace.createFileSystemWatcher('**/*')
  let refreshTimer

  const scheduleRefresh = (uri) => {
    if (!isRootLevelDotEntry(uri)) {
      return
    }

    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => refreshAll(provider, context), 300)
  }

  watcher.onDidCreate(scheduleRefresh)
  watcher.onDidDelete(scheduleRefresh)

  context.subscriptions.push(
    treeView,
    refreshCommand,
    toggleHideCommand,
    restoreExplorerCommand,
    revealInGroupCommand,
    workspaceFoldersListener,
    configListener,
    watcher
  )

  vscode.commands.executeCommand('setContext', 'dotFolderGroup.enabled', isExtensionEnabled())
  refreshAll(provider, context)
}

async function deactivate() {
  if (!extensionContext) {
    return
  }

  const knownDotFolders = treeProvider ? treeProvider.dotFolders : []
  await removeManagedHiding(extensionContext, knownDotFolders)
  await vscode.commands.executeCommand('setContext', 'dotFolderGroup.enabled', false)
  await vscode.commands.executeCommand('setContext', 'dotFolderGroup.hasFolders', false)

  extensionContext = null
  treeProvider = null
}

module.exports = {
  activate,
  deactivate
}

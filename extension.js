const vscode = require('vscode')
const fs = require('fs')
const path = require('path')

function getConfig() {
  return vscode.workspace.getConfiguration('dotFolderGroup')
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
    if (!getConfig().get('enabled', true)) {
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

function getRootExcludePattern(folderName) {
  return folderName
}

async function syncExplorerHiding(context, dotFolders) {
  const hideInExplorer = getConfig().get('hideInExplorer', true)
  const filesConfig = vscode.workspace.getConfiguration('files')
  const currentExclude = filesConfig.get('exclude', {})
  const nextExclude = { ...currentExclude }
  const managedPatterns = context.workspaceState.get('managedExcludePatterns', [])

  for (const pattern of managedPatterns) {
    delete nextExclude[pattern]
  }

  const newManagedPatterns = []

  if (hideInExplorer && getConfig().get('enabled', true)) {
    for (const folder of dotFolders) {
      const pattern = getRootExcludePattern(folder.name)
      nextExclude[pattern] = true
      newManagedPatterns.push(pattern)
    }
  }

  await context.workspaceState.update('managedExcludePatterns', newManagedPatterns)
  await filesConfig.update('exclude', nextExclude, vscode.ConfigurationTarget.Workspace)
}

async function refreshAll(provider, context) {
  const dotFolders = await provider.reloadDotFolders()
  await syncExplorerHiding(context, dotFolders)
  provider.refresh()
}

function activate(context) {
  const provider = new DotFolderTreeProvider()

  const treeView = vscode.window.createTreeView('dotFolderGroup.explorer', {
    treeDataProvider: provider,
    showCollapseAll: true
  })

  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand('dotFolderGroup.refresh', () => refreshAll(provider, context)),
    vscode.commands.registerCommand('dotFolderGroup.toggleHide', async () => {
      const config = getConfig()
      const nextValue = !config.get('hideInExplorer', true)
      await config.update('hideInExplorer', nextValue, vscode.ConfigurationTarget.Workspace)
      await refreshAll(provider, context)
      vscode.window.showInformationMessage(
        nextValue ? 'Dot-folders hidden from the default Explorer' : 'Dot-folders visible in the default Explorer'
      )
    }),
    vscode.commands.registerCommand('dotFolderGroup.revealInGroup', async (resource) => {
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
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshAll(provider, context)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('dotFolderGroup')) {
        vscode.commands.executeCommand('setContext', 'dotFolderGroup.enabled', getConfig().get('enabled', true))
        refreshAll(provider, context)
      }
    }),
    (() => {
      const watcher = vscode.workspace.createFileSystemWatcher('**/*')
      let refreshTimer

      const scheduleRefresh = () => {
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => refreshAll(provider, context), 300)
      }

      watcher.onDidCreate(scheduleRefresh)
      watcher.onDidDelete(scheduleRefresh)
      context.subscriptions.push(watcher)
    })()
  )

  vscode.commands.executeCommand('setContext', 'dotFolderGroup.enabled', getConfig().get('enabled', true))
  refreshAll(provider, context)
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
}

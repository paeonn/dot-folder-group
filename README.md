# Dot Folder Group

> Keep your Explorer clean by grouping all dot-folders (`.vscode`, `.github`, `.cursor`, ...) under a single collapsible node.

Tired of scrolling past a wall of dot-folders at the top of your file tree? **Dot Folder Group** tucks them all into one tidy node — just like how lockfiles nest under `package.json`.

## Features

- **One node to rule them all** — every dot-folder at the workspace root lives under a single expandable group.
- **Cleaner Explorer** — dot-folders are hidden from the default tree and shown only inside the group.
- **Full navigation** — open files and folders inside the group exactly like in the normal Explorer.
- **Reveal in group** — right-click any dot-folder to jump straight to it in the group.
- **Fully configurable** — choose the group label, which folders to skip, and whether to hide them.

## How it works

1. **Dot Folders** — a new Explorer section with a root node (default: `.`) containing all dot-folders at the workspace root.
2. **Default Explorer** — with `dotFolderGroup.hideInExplorer` enabled (default), those folders disappear from the main tree and appear only in the group.
3. **Navigation** — clicking files and folders inside the group opens them normally in the editor.

> The VS Code/Cursor API does not allow modifying the native Explorer tree for folders. This extension achieves the same visual effect with a dedicated view in the same panel.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `dotFolderGroup.enabled` | `true` | Enable or disable the extension |
| `dotFolderGroup.hideInExplorer` | `true` | Hide dot-folders from the default Explorer |
| `dotFolderGroup.groupLabel` | `"."` | Label for the group root node |
| `dotFolderGroup.exclude` | `[".git"]` | Dot-folders to skip (not grouped or hidden) |

## Commands

- **Refresh Dot Folders** — refresh icon in the view title bar
- **Dot Folder Group: Toggle Hide Dot-Folders in Explorer** — toggle visibility in the default Explorer
- **Reveal in Dot Folder Group** — right-click a dot-folder in the Explorer to focus it in the group
- **Dot Folder Group: Restore Explorer** — instantly bring every hidden dot-folder back to the default Explorer (run this before uninstalling to guarantee a clean restore)

## Uninstalling

The extension automatically restores the default Explorer on deactivation. Since editors do not always flush settings writes during uninstall, you can run **Dot Folder Group: Restore Explorer** first to guarantee every dot-folder is unhidden before removing the extension.

## Local development

1. Open the project folder in Cursor.
2. Press `F5` to launch an Extension Development Host window.
3. In the new window, open your workspace.

Or install permanently:

```bash
npx @vscode/vsce package --allow-missing-repository
```

Then: **Extensions** → **...** → **Install from VSIX** → select the generated `.vsix` file.

## Workspace recommendation

Add to `.vscode/extensions.json`:

```json
{
  "recommendations": ["paeonn.dot-folder-group"]
}
```

## License

MIT

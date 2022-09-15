import * as vscode from "vscode";
import { to_sql } from "prql-js";
import * as shiki from "shiki";
import { readFileSync } from "node:fs";
import { CompilationResult, getResourceUri, isPrqlDocument, normalizeThemeName } from "./utils";

function getCompiledTemplate(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const template = readFileSync(getResourceUri(context, "sql_output.html").fsPath, "utf-8");
  const templateJS = getResourceUri(context, "sql_output.js");
  const templateCss = getResourceUri(context, "sql_output.css");

  return (template as string)
    .replace(/##CSP_SOURCE##/g, webview.cspSource)
    .replace("##JS_URI##", webview.asWebviewUri(templateJS).toString())
    .replace("##CSS_URI##", webview.asWebviewUri(templateCss).toString())
}

function getThemeName(): string {
  const currentThemeName = vscode.workspace.getConfiguration("workbench")
    .get<string>("colorTheme", "dark-plus");

  for (const themeName of [currentThemeName, normalizeThemeName(currentThemeName)]) {
    if (shiki.BUNDLED_THEMES.includes(themeName as shiki.Theme)) {
      return themeName;
    }
  }

  return "css-variables";
}

let highlighter: shiki.Highlighter | undefined;

async function getHighlighter(): Promise<shiki.Highlighter> {
  if (highlighter) {
    return Promise.resolve(highlighter);
  }

  return highlighter = await shiki.getHighlighter({ theme: getThemeName() });
}

async function compilePrql(text: string, lastOkHtml: string | undefined):
  Promise<CompilationResult> {
  try {
    const sql = to_sql(text);
    const highlighter = await getHighlighter();
    const highlighted = highlighter.codeToHtml(sql ? sql : "", {
      lang: "sql"
    });

    return {
      status: "ok",
      content: highlighted
    };
  } catch (err: any) {
    return {
      status: "error",
      content: err.message.split("\n").slice(1, -1).join("\n"),
      last_html: lastOkHtml
    };
  }
}

let lastOkHtml: string | undefined;

function sendText(panel: vscode.WebviewPanel) {
  const editor = vscode.window.activeTextEditor;

  if (panel.visible && editor && isPrqlDocument(editor)) {
    const text = editor.document.getText();
    compilePrql(text, lastOkHtml).then(result => {
      if (result.status === "ok") {
        lastOkHtml = result.content;
      }
      panel.webview.postMessage(result)
    });
  }
}

function sendThemeChanged(panel: vscode.WebviewPanel) {
  panel.webview.postMessage({ status: "theme-changed" });
}

function createWebviewPanel(context: vscode.ExtensionContext, onDidDispose: () => any): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel("prqlSqlOutputPanel", "PRQL - SQL Output",
    {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true
    },
    {
      enableFindWidget: false,
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "resources")]
    }
  );
  panel.webview.html = getCompiledTemplate(context, panel.webview);

  const disposables: vscode.Disposable[] = [];

  disposables.push(vscode.workspace.onDidChangeTextDocument(() => {
    sendText(panel);
  }));

  let lastEditor: vscode.TextEditor | undefined = undefined;
  disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor && editor !== lastEditor) {
      lastEditor = editor;
      lastOkHtml = undefined;
      sendText(panel);
    }
  }));

  disposables.push(vscode.window.onDidChangeActiveColorTheme(() => {
    highlighter = undefined;
    lastOkHtml = undefined;
    sendThemeChanged(panel);
  }));

  panel.onDidDispose(() => {
    disposables.forEach(d => d.dispose());
    onDidDispose();
  }, undefined, context.subscriptions);

  sendText(panel);

  return panel;
}

export function activateSqlOutputPanel(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | undefined = undefined;
  let panelViewColumn: vscode.ViewColumn | undefined = undefined;

  const command = vscode.commands.registerCommand("prqlSqlOutputPanel.open", () => {
    if (panel) {
      panel.reveal(panelViewColumn, true);
    } else {
      panel = createWebviewPanel(context, () => panel = undefined);
      panelViewColumn = panel.viewColumn;
    }
  });
  context.subscriptions.push(command);
}

import { basicSetup, EditorView } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { EditorState, Compartment } from '@codemirror/state';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import YAML from 'yaml';

export interface CodeEditorCallbacks {
  onChange?: (value: string) => void;
  onApply?: () => void;
  onSave?: () => void;
  onCursorChange?: (line: number, col: number, selectionLength: number) => void;
}

export interface CodeEditorOptions extends CodeEditorCallbacks {
  parent: HTMLElement;
  initialValue?: string;
  readOnly?: boolean;
}

/**
 * YAML sözdizimi hatalarını canlı yakalayan linter
 */
function createYamlLinter() {
  return linter(
    (view) => {
      const diagnostics: Diagnostic[] = [];
      const text = view.state.doc.toString();
      if (!text.trim()) return diagnostics;

      try {
        YAML.parse(text);
      } catch (err: any) {
        if (err && typeof err === 'object') {
          const docLen = view.state.doc.length;
          let from = 0;
          let to = 0;

          if (Array.isArray(err.pos) && err.pos.length >= 2) {
            from = Math.min(Math.max(0, Number(err.pos[0])), docLen);
            to = Math.min(Math.max(from + 1, Number(err.pos[1])), docLen);
          } else if (err.linePos && Array.isArray(err.linePos) && err.linePos[0]) {
            try {
              const lineNum = Math.min(Math.max(1, Number(err.linePos[0].line)), view.state.doc.lines);
              const line = view.state.doc.line(lineNum);
              const col = Math.max(1, Number(err.linePos[0].col));
              from = Math.min(line.from + col - 1, line.to);
              to = Math.min(from + 1, line.to);
            } catch {
              from = 0;
              to = Math.min(1, docLen);
            }
          } else {
            from = 0;
            to = Math.min(1, docLen);
          }

          diagnostics.push({
            from,
            to,
            severity: 'error',
            message: err.message ? err.message.split('\n')[0] : 'YAML sözdizimi hatası',
          });
        }
      }
      return diagnostics;
    },
    { delay: 350 },
  );
}

/**
 * Editörün arayüze tam uyum sağlayan özel teması
 */
const customEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '12.5px',
      fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace",
      backgroundColor: '#13151b',
      color: '#e2e8f0',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'inherit',
      lineHeight: '1.55',
    },
    '.cm-content': {
      padding: '8px 0',
      caretColor: '#f59e0b',
    },
    '.cm-line': {
      padding: '0 12px 0 8px',
    },
    '.cm-gutters': {
      backgroundColor: '#101217',
      color: '#555d6e',
      borderRight: '1px solid #232733',
      userSelect: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 10px',
      minWidth: '28px',
      textAlign: 'right',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#1b1f28',
      color: '#cbd5e1',
      fontWeight: '600',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.035)',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: '#264f78 !important',
    },
    '.cm-cursor': {
      borderLeftColor: '#f59e0b',
      borderLeftWidth: '2px',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: '#232834',
      border: '1px solid #3b4252',
      color: '#94a3b8',
      borderRadius: '3px',
      padding: '0 5px',
      margin: '0 3px',
    },
    '.cm-panels': {
      backgroundColor: '#171920',
      color: '#cbd5e1',
      borderBottom: '1px solid #282d3b',
    },
    '.cm-panel.cm-search': {
      padding: '6px 10px',
      gap: '6px',
    },
    '.cm-panel.cm-search input': {
      background: '#232733',
      border: '1px solid #363d4e',
      color: '#f8fafc',
      borderRadius: '4px',
      padding: '3px 7px',
      fontSize: '12px',
    },
    '.cm-panel.cm-search button': {
      background: '#2c3242',
      border: '1px solid #3c4458',
      color: '#e2e8f0',
      borderRadius: '4px',
      padding: '3px 8px',
      fontSize: '12px',
      cursor: 'pointer',
    },
    '.cm-panel.cm-search button:hover': {
      background: '#3a4258',
    },
    '.cm-tooltip': {
      backgroundColor: '#1e222d',
      border: '1px solid #3b4356',
      borderRadius: '6px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      color: '#f1f5f9',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#2b3447',
      color: '#ffffff',
    },
    '.cm-diagnostic-error': {
      borderLeft: '3px solid #ef4444',
      padding: '4px 8px',
    },
  },
  { dark: true },
);

export class ScenarioCodeEditor {
  private view: EditorView;
  private changeCallbacks: Array<(value: string) => void> = [];
  private readOnlyCompartment = new Compartment();

  constructor(options: CodeEditorOptions) {
    if (options.onChange) {
      this.changeCallbacks.push(options.onChange);
    }

    const customKeymaps = keymap.of([
      indentWithTab,
      {
        key: 'Mod-Enter',
        run: () => {
          if (options.onApply) {
            options.onApply();
            return true;
          }
          return false;
        },
      },
      {
        key: 'Mod-s',
        run: (v) => {
          if (options.onSave) {
            options.onSave();
            return true;
          }
          return false;
        },
        preventDefault: true,
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const val = update.state.doc.toString();
        for (const cb of this.changeCallbacks) {
          cb(val);
        }
      }

      if (update.selectionSet || update.docChanged) {
        if (options.onCursorChange) {
          const main = update.state.selection.main;
          const line = update.state.doc.lineAt(main.head);
          const col = main.head - line.from + 1;
          const selLen = Math.abs(main.to - main.from);
          options.onCursorChange(line.number, col, selLen);
        }
      }
    });

    const state = EditorState.create({
      doc: options.initialValue ?? '',
      extensions: [
        basicSetup,
        yaml(),
        oneDark,
        customEditorTheme,
        EditorView.lineWrapping,
        lintGutter(),
        createYamlLinter(),
        customKeymaps,
        updateListener,
        this.readOnlyCompartment.of(EditorState.readOnly.of(Boolean(options.readOnly))),
      ],
    });

    this.view = new EditorView({
      state,
      parent: options.parent,
    });
  }

  public getValue(): string {
    return this.view.state.doc.toString();
  }

  public setValue(newValue: string): void {
    const current = this.getValue();
    if (current === newValue) return;

    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: newValue,
      },
    });
  }

  public onChange(cb: (value: string) => void): () => void {
    this.changeCallbacks.push(cb);
    return () => {
      this.changeCallbacks = this.changeCallbacks.filter((c) => c !== cb);
    };
  }

  public focus(): void {
    this.view.focus();
  }

  public getView(): EditorView {
    return this.view;
  }

  public getDom(): HTMLElement {
    return this.view.dom;
  }

  public setReadOnly(readOnly: boolean): void {
    this.view.dispatch({
      effects: this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }

  public destroy(): void {
    this.view.destroy();
  }
}

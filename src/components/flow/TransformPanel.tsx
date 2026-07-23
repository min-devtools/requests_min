import { useEffect, useMemo } from "react";
import { isTransformNode } from "../../lib/flow/types";
import { TRANSFORM_PLACEHOLDER, parentStepRef, transformInput } from "../../lib/flow/transform";
import { isStepKey } from "../../lib/flow/validate";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";
import { JsonEditor } from "../../ui/JsonEditor";
import { JsonTreePanel } from "../../ui/JsonTreePanel";
import { SectionVeil } from "../../ui/SectionVeil";
import { confirmDeleteNode } from "./nodeActions";

// The transform step's dock editor: input (value) preview, the JS body, and the last return.
export function TransformPanel({ tabId }: { tabId: string }) {
  const ft = useApp((state) => state.flowTabs[tabId]);
  const updateFlowTab = useApp((state) => state.updateFlowTab);
  const opened = ft?.flow.nodes.find((item) => item.id === ft.panelNodeId);
  const node = opened && isTransformNode(opened) ? opened : undefined;

  // once a single step is wired in, swap the template's placeholder for its real ref (one-time)
  const autofillRef = ft && node ? parentStepRef(ft.flow, node.id) : null;
  useEffect(() => {
    if (!ft || !node || !autofillRef || !node.config.code.includes(TRANSFORM_PLACEHOLDER) || ft.running) return;
    const code = node.config.code.replace(TRANSFORM_PLACEHOLDER, autofillRef);
    useApp.getState().updateFlowTab(tabId, {
      flow: {
        ...ft.flow,
        nodes: ft.flow.nodes.map((item) => item.id === node.id && item.type === "transform"
          ? { ...item, config: { ...item.config, code } }
          : item),
      },
    });
  }, [tabId, node?.id, autofillRef, node?.config.code, ft?.running]);

  // Preview of the wired-in data. Keyed on run + edges (NOT the script text) so its reference stays
  // stable while typing — otherwise JsonTreePanel resets its collapse state on every keystroke.
  const inputValue = useMemo(() => {
    if (!ft?.run || !node) return undefined;
    try { return transformInput(ft.flow, ft.run, node.id); } catch { return undefined; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ft?.run, ft?.flow.edges, node?.id]);

  if (!ft || !node) {
    return (
      <div className="inspector-empty flow-panel-hint">
        Click a transform block on the canvas to edit it here.
      </div>
    );
  }

  const result = ft.run?.steps[node.id];

  const updateKey = (key: string) => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    updateFlowTab(tabId, {
      flow: {
        ...current.flow,
        nodes: current.flow.nodes.map((item) => item.id === node.id ? { ...item, key } : item),
      },
    });
  };

  const updateCode = (code: string) => {
    const current = useApp.getState().flowTabs[tabId];
    if (!current || current.running) return;
    updateFlowTab(tabId, {
      flow: {
        ...current.flow,
        nodes: current.flow.nodes.map((item) => item.id === node.id && item.type === "transform"
          ? { ...item, config: { ...item.config, code } }
          : item),
      },
    });
  };

  const keyError = !isStepKey(node.key)
    ? "Lowercase letters, digits and dashes only (e.g. shape-user)"
    : ft.flow.nodes.some((item) => item.id !== node.id && item.key === node.key)
      ? "This key is already used by another step"
      : null;

  return (
    <section className="flow-node-panel flow-transform-panel" aria-label="Selected transform step">
      <div className="flow-node-panel-head">
        <label>
          <span>Key</span>
          <input
            value={node.key}
            disabled={ft.running}
            aria-invalid={keyError !== null}
            onChange={(event) => updateKey(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="tool-btn icon-only danger"
          title="Delete step"
          aria-label={`Delete step ${node.key}`}
          disabled={ft.running}
          onClick={() => void confirmDeleteNode(tabId, node.id, node.key)}
        >
          <Icon name="trash" />
        </button>
        <button
          type="button"
          className="tool-btn icon-only"
          title="Close step details"
          aria-label="Close step details"
          onClick={() => updateFlowTab(tabId, { panelNodeId: null })}
        >
          <Icon name="x" />
        </button>
      </div>
      {keyError && <div className="flow-key-error">{keyError}</div>}
      {result?.error && <div className="flow-step-error">{result.error}</div>}

      <div className="flow-transform-body">
        <section className="flow-transform-io">
          <div className="inspector-section-label"><Icon name="key" size={12} /> Wired input — what <code>{"{{steps.…}}"}</code> resolves to</div>
          {inputValue !== undefined
            ? <JsonTreePanel value={inputValue} />
            : <div className="inspector-empty">Wire a step into this block and run the flow to preview its data.</div>}
        </section>

        <section className="flow-transform-code">
          <div className="inspector-section-label"><Icon name="braces" size={12} /> Script — <code>{"{{steps.…}}"}</code> refs are inlined as JSON; <code>return</code> the output</div>
          <JsonEditor value={node.config.code} onChange={updateCode} language="javascript" />
        </section>

        <section className="flow-transform-io">
          <div className="inspector-section-label"><Icon name="activity" size={12} /> Return · output</div>
          {result?.status === "success"
            ? <JsonTreePanel value={result.output ?? null} />
            : <div className="inspector-empty">Run the flow to see this step's return.</div>}
        </section>

        <SectionVeil on={ft.running} label="Flow running…" />
      </div>
    </section>
  );
}

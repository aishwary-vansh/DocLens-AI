// src/components/ui/PromptInput.jsx
// Chat composer: auto-growing textarea plus a send button. Styled by
// .prompt-input rules in styles/design-system.css so it follows the theme.
import * as React from "react";
import { ArrowUp } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";

/**
 * PromptInput — chat textarea with:
 *  - Auto-growing textarea via react-textarea-autosize
 *  - Accessible loading state with spinner
 *  - A hint line (optional) under the textarea
 *
 * The earlier mic / magic / attach buttons and the credits banner had no
 * behaviour behind them and were removed.
 */
const PromptInput = React.forwardRef(
  ({ onSubmit, isLoading, className = "", hint, ...props }, ref) => {
    const disabled = isLoading || !props.value;
    return (
      <div className={`prompt-input ${isLoading ? "is-loading" : ""} ${className}`}>
        <TextareaAutosize ref={ref} minRows={1} maxRows={8} className="prompt-input-field" {...props} />
        <div className="prompt-input-toolbar">
          <span className="prompt-input-hint">{hint}</span>
          <button
            type="button"
            className="prompt-input-send"
            onClick={onSubmit}
            aria-label={isLoading ? "Answer in progress" : "Send question"}
            disabled={disabled}
          >
            {isLoading ? <span className="prompt-input-spinner" aria-hidden="true" /> : <ArrowUp size={17} />}
          </button>
        </div>
      </div>
    );
  }
);

PromptInput.displayName = "PromptInput";
export { PromptInput };
